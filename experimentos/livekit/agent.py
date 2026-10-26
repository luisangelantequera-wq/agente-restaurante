"""Agente de voz experimental: no se despliega en Vercel.

Ejecutar en un servidor/worker LiveKit separado. No almacena audio ni
transcripciones en archivos. Las políticas de retención de proveedores
deben verificarse por separado antes de usar datos reales.
"""
import asyncio
import json
import os
import time
from urllib.parse import urlparse, parse_qs
import aiohttp
from dotenv import load_dotenv
from livekit import rtc, api

from livekit.agents import Agent, AgentServer, AgentSession, JobContext, RunContext, cli, function_tool, inference

load_dotenv(".env.local")

AGENT_NAME = "contactia-cartesia-prueba"
server = AgentServer()


class RecepcionistaPrueba(Agent):
    def __init__(self, ctx: JobContext, browser_identity: str, relay=None):
        super().__init__(instructions=(
            "Es usted el recepcionista de Restaurante Sol en una prueba privada. "
            "Hable en español peninsular de forma breve, natural y siempre de usted. "
            "El sistema Contactia es el único que decide horarios, disponibilidad, "
            "retenciones, confirmaciones y cancelaciones. "
            "En cada intervención nueva del cliente invoque procesar_turno_contactia "
            "una sola vez con las palabras LITERALES del turno actual. "
            "No resuma, no amplíe, no recupere frases de turnos anteriores "
            "ni añada datos que el cliente no ha dicho. "
            "Si dice 'Sí', la herramienta debe recibir exactamente 'Sí'. "
            "Nunca invente disponibilidad ni confirme una reserva por su cuenta. "
            "Espere al resultado de la herramienta y comunique solo su campo respuesta, "
            "sin agregar ni alterar horas, fechas, personas, nombres o localizadores. "
            "No solicite datos personales reales: esta sesión es de prueba y "
            "debe usarse exclusivamente con datos ficticios. "
            "Si hay un fallo técnico, indique que no ha podido completar la operación."
        ))
        self.ctx = ctx
        self.browser_identity = browser_identity
        self.relay = relay

    @function_tool()
    async def procesar_turno_contactia(self, context: RunContext, mensaje: str) -> str:
        """Entrega el turno del cliente al motor de reservas de Contactia.

        Args:
            mensaje: Transcripción fiel de lo dicho por el cliente en español.
        """
        if not mensaje or len(mensaje) > 1000:
            return json.dumps({"respuesta": "Repita su petición de forma más breve."}, ensure_ascii=False)
        start = time.monotonic()
        try:
            if self.relay is not None:
                return await self.relay.enviar(mensaje)
            result = await self.ctx.room.local_participant.perform_rpc(
                destination_identity=self.browser_identity,
                method="contactia.procesar_turno",
                payload=json.dumps({"mensaje": mensaje}, ensure_ascii=False),
                response_timeout=15,
            )
            parsed = json.loads(result)
            # No registrar los mensajes: contienen datos incluso en pruebas.
            return json.dumps({
                "respuesta": str(parsed.get("respuesta") or "No he podido procesar su petición.")[:2000],
                "paso": str(parsed.get("paso") or "")[:60],
            }, ensure_ascii=False)
        except Exception:
            return json.dumps({
                "respuesta": "No he podido comprobar la reserva. Inténtelo de nuevo."
            }, ensure_ascii=False)
        finally:
            # Medición de solo tiempo: jamás incluye texto, teléfono ni email.
            print(json.dumps({"tipo": "latencia_motor_ms",
                              "valor": round((time.monotonic() - start) * 1000)}))


@server.rtc_session(agent_name=AGENT_NAME)
async def contactia(ctx: JobContext):
    if ctx.room.name.startswith("contactia-telefono-"):
        await contactia_telefono(ctx)
        return
    await ctx.connect()
    # Las salas son privadas, de un solo cliente. Se espera al navegador.
    browser = await ctx.wait_for_participant(kind=rtc.ParticipantKind.PARTICIPANT_KIND_STANDARD)
    await iniciar_sesion(ctx, browser)


async def iniciar_sesion(ctx, participante, relay=None):
    session = AgentSession(
        stt=inference.STT(model="deepgram/nova-3", language="es"),
        llm=inference.LLM(model="openai/gpt-4.1-mini"),
        # Rime Coda no admite el servicio EU: REGION_RESTRICTED en Cloud.
        # Marta: voz conversacional de España del catálogo oficial de Cartesia.
        tts=inference.TTS(
            model="cartesia/sonic-3",
            voice="de38f545-c574-44e8-9b54-a7d6fec1c6b1",
            language="es",
        ),
    )
    @session.on("metrics_collected")
    def on_metrics(ev):
        # Solo métricas numéricas; no contenido de conversación.
        metric = getattr(ev, "metrics", None)
        if metric is None:
            return
        record = {"tipo": "livekit_metric", "clase": type(metric).__name__}
        for name in ("ttft", "ttfb", "duration", "latency", "audio_duration",
                     "input_tokens", "output_tokens", "characters_count"):
            value = getattr(metric, name, None)
            if isinstance(value, (int, float)):
                record[name] = round(value, 5)
        print(json.dumps(record))
    await session.start(
        agent=RecepcionistaPrueba(ctx, participante.identity, relay),
        room=ctx.room,
        record=False,  # Desactivar audio, transcripciones, trazas y logs en Agent Insights.
    )
    await session.say(
        "Bienvenido a Restaurante Sol. Esta es una prueba con datos ficticios. "
        "¿Desea hacer una reserva?"
    )
    return session


class MotorTelefonico:
    """Estado opaco en memoria del worker; ninguna credencial global en el job."""
    HOST = "agente-restaurante-git-migrac-db4675-reservas-projects-46f41d07.vercel.app"

    def __init__(self, datos, http, terminado=None, *, url=None):
        # La URL con bypass es un secreto del worker, nunca metadata del job.
        url = url if url is not None else os.getenv("CONTACTIA_TELEFONO_MOTOR_URL", "")
        u = urlparse(url)
        q = parse_qs(u.query)
        if (datos.get("version") != 1 or datos.get("host") != self.HOST
                or u.scheme != "https" or u.netloc != self.HOST
                or u.path != "/api/restaurante" or u.fragment
                or q.get("canal") != ["telefono_motor"]
                or set(q) - {"canal", "x-vercel-protection-bypass"}
                or not isinstance(datos.get("exp"), (int, float))
                or not time.time() * 1000 < datos["exp"] <= time.time() * 1000 + 180000
                or not isinstance(datos.get("acceso"), str)
                or not isinstance(datos.get("conversacion_token"), str)):
            raise ValueError("Conexión telefónica no válida")
        self.url = url
        self.acceso = datos["acceso"]
        self.token = datos["conversacion_token"]
        self.http = http
        self.pendiente = None
        self.cerrada = False
        self.lock = asyncio.Lock()
        self.terminado = terminado

    async def enviar(self, mensaje):
        async with self.lock:
            if self.cerrada:
                return json.dumps({"respuesta": "La reserva de prueba ya está confirmada.", "paso": "terminado"})
            if self.pendiente is not None and mensaje.strip().lower().rstrip(".!? ") not in ("reintentar", "sí", "si"):
                return json.dumps({"respuesta": "El resultado anterior está pendiente. Diga reintentar para comprobarlo sin crear otra reserva."})
            # Si se pierde la respuesta, conservar exactamente el turno y token
            # anteriores. El UUID de reserva del servidor tampoco cambia.
            turno = self.pendiente if self.pendiente is not None else mensaje
            self.pendiente = turno
            try:
                async with self.http.post(self.url,
                    headers={"Authorization": "Bearer " + self.acceso},
                    json={"mensaje": turno, "conversacion_token": self.token},
                    allow_redirects=False) as r:
                    if r.status != 200:
                        raise RuntimeError("Motor no disponible")
                    d = await r.json()
                if (d.get("ok") is not True or not isinstance(d.get("conversacion_token"), str)
                        or not isinstance(d.get("respuesta"), str)):
                    raise RuntimeError("Respuesta no válida")
                self.token = d["conversacion_token"]
                self.pendiente = None
                if d.get("paso") == "terminado":
                    self.cerrada = True
                    if self.terminado:
                        self.terminado()
                return json.dumps({"respuesta": d["respuesta"][:4000], "paso": d.get("paso", "")}, ensure_ascii=False)
            except Exception:
                return json.dumps({"respuesta": "No he podido comprobar el resultado. Diga reintentar para comprobarlo sin duplicar la reserva."}, ensure_ascii=False)


async def contactia_telefono(ctx: JobContext):
    # Un solo rtc_session por AgentServer. Las salas telefónicas y su metadata
    # privada seleccionan el transporte; las salas web conservan su RPC.
    datos = json.loads(ctx.job.metadata or "{}")
    await ctx.connect()
    if datos.get("room") != ctx.room.name:
        ctx.shutdown(reason="Conexión no válida")
        return
    participante = await asyncio.wait_for(ctx.wait_for_participant(
        identity=datos.get("identity"),
        kind=rtc.ParticipantKind.PARTICIPANT_KIND_CONNECTOR), timeout=25)
    http = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=20))
    ctx.add_shutdown_callback(http.close)
    tareas = set()
    async def colgar():
        # Eliminar la sala termina el conector y hace que Twilio ejecute Hangup.
        async with api.LiveKitAPI() as lk:
            await lk.room.delete_room(api.DeleteRoomRequest(room=ctx.room.name))
    async def limite():
        await asyncio.sleep(max(0, datos["exp"] / 1000 - time.time()))
        await colgar()
    def lanzar(coro):
        tarea = asyncio.create_task(coro)
        tareas.add(tarea)
        tarea.add_done_callback(tareas.discard)
    session = None
    async def cierre_final():
        # Esperar a que la respuesta final se termine de locutar. No colgar
        # desde la herramienta antes de que el LLM/TTS haya hablado.
        await asyncio.sleep(1)
        try:
            await asyncio.wait_for(final_locutado.wait(), timeout=20)
        except asyncio.TimeoutError:
            pass
        await asyncio.sleep(1.5)
        await colgar()
    final_locutado = asyncio.Event()
    relay = MotorTelefonico(datos,http,terminado=lambda: lanzar(cierre_final()))
    lanzar(limite())
    session = await iniciar_sesion(ctx,participante,relay)
    @session.on("agent_state_changed")
    def estado_agente(ev):
        if relay.cerrada and getattr(ev,"new_state",None) == "listening":
            final_locutado.set()
    async def limpiar():
        for tarea in list(tareas):
            tarea.cancel()
        await asyncio.gather(*list(tareas), return_exceptions=True)
    ctx.add_shutdown_callback(limpiar)


if __name__ == "__main__":
    cli.run_app(server)
