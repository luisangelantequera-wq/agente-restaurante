"""Agente de voz experimental: no se despliega en Vercel.

Ejecutar en un servidor/worker LiveKit separado. No almacena audio ni
transcripciones en archivos. Las políticas de retención de proveedores
deben verificarse por separado antes de usar datos reales.
"""
import asyncio
import json
import hashlib
import hmac
import os
import re
import time
import unicodedata
from datetime import datetime
from urllib.parse import urlparse, parse_qs
from zoneinfo import ZoneInfo
import aiohttp
from dotenv import load_dotenv
from livekit import rtc, api

from livekit.agents import Agent, AgentServer, AgentSession, JobContext, RunContext, StopResponse, cli, function_tool, inference

load_dotenv(".env.local")

AGENT_NAME = "contactia-cartesia-prueba"
VOZ_AZURE_PRUEBA = "es-ES-Ximena:DragonHDLatestNeural"
server = AgentServer()


def _registro_transferencia(etapa, **datos):
    # Solo estados y códigos controlados; no incluir audio, teléfonos ni errores completos.
    print(json.dumps({"tipo": "contactia_transferencia", "etapa": etapa, **datos}), flush=True)


class RecepcionistaPrueba(Agent):
    def __init__(self, ctx: JobContext, browser_identity: str, relay=None):
        restaurante = relay.nombre_restaurante if relay is not None else "Restaurante Sol"
        super().__init__(instructions=(
            f"Es usted el recepcionista de {restaurante} en una prueba privada. "
            "Hable en español peninsular de forma breve, natural y siempre de usted. "
            "El sistema Contactia es el único que decide horarios, disponibilidad, "
            "retenciones, confirmaciones y cancelaciones. "
            "En cada intervención nueva del cliente invoque procesar_turno_contactia "
            "una sola vez con las palabras LITERALES del turno actual. "
            "No resuma, no amplíe, no recupere frases de turnos anteriores "
            "ni añada datos que el cliente no ha dicho. "
            "Si dice 'Sí', la herramienta debe recibir exactamente 'Sí'. "
            "Nunca invente disponibilidad ni confirme una reserva por su cuenta. "
            "No hable antes de invocar la herramienta ni mientras espera su resultado. "
            "No anticipe preguntas, no anuncie lo que va a hacer ni añada frases de espera. "
            "En modificaciones, no pida qué cambio quiere realizar por su cuenta: "
            "Contactia verifica primero teléfono y código, salvo que el cliente adelante el cambio. "
            "Espere al resultado de la herramienta y comunique solo su campo respuesta, "
            "sin agregar ni alterar horas, fechas, personas, nombres o localizadores. "
            "En asistencia telefónica, lea el número cifra por cifra tal como aparece y espere cada respuesta. "
            "Si el resultado indica paso transferida, permanezca en silencio. "
            "No solicite datos personales reales: esta sesión es de prueba y "
            "debe usarse exclusivamente con datos ficticios. "
            "Si hay un fallo técnico, indique que no ha podido completar la operación."
        ))
        self.ctx = ctx
        self.browser_identity = browser_identity
        self.relay = relay

    async def on_user_turn_completed(self, turn_ctx, new_message):
        # En este paso solo se dicta un número público ya validado. Usar el
        # turno transcrito y el texto del motor directamente, sin pasar por el LLM.
        if self.relay is not None and self.relay.esperando_repeticion_telefono():
            resultado = json.loads(await self.relay.enviar(new_message.text_content or ""))
            self.session.say(resultado["respuesta"])
            raise StopResponse()

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


def sintetizador_prueba(*, sip_sol=False):
    if sip_sol and os.getenv("CONTACTIA_VOZ_SIP", "cartesia") == "azure":
        clave = os.getenv("AZURE_SPEECH_KEY", "").strip()
        region = os.getenv("AZURE_SPEECH_REGION", "").strip()
        if not clave or not region:
            raise RuntimeError("Faltan los ajustes de Azure Speech para Sol")
        from livekit.plugins import azure

        # Sin sustitución silenciosa: la única llamada debe probar Ximena.
        return azure.TTS(voice=VOZ_AZURE_PRUEBA, language="es-ES",
                         speech_key=clave, speech_region=region)
    return inference.TTS(
        model="cartesia/sonic-3",
        voice="ad38904c-0ce9-42b1-9159-5ad5352ef089",
        language="es",
    )


async def iniciar_sesion(ctx, participante, relay=None):
    session = AgentSession(
        stt=inference.STT(model="deepgram/nova-3", language="es"),
        llm=inference.LLM(model="openai/gpt-4.1-mini"),
        tts=sintetizador_prueba(sip_sol=ctx.room.name.startswith("contactia-telefono-sol-")),
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
    restaurante = relay.nombre_restaurante if relay is not None else "Restaurante Sol"
    await session.say(f"Bienvenido al sistema de reservas de {restaurante}. ¿En qué le puedo ayudar?")
    return session


def _numero_asistencia(numero):
    return isinstance(numero, str) and re.fullmatch(r"\+[1-9][0-9]{7,14}", numero)


def _confirma_reserva(texto):
    return bool(re.fullmatch(
        r"(?:si|s|zi)(?: (?:es|esta|todo|son|los datos son|correcto|correctos|bien|por favor|si))*"
        r"|(?:si )?confirmo(?: los datos)?|(?:los datos )?son correctos?"
        r"|(?:todo )?(?:correctos?|esta bien)|de acuerdo|vale|adelante", texto
    ))


def _en_horario(asistencia, ahora=None):
    try:
        local = (ahora or datetime.now(ZoneInfo("UTC"))).astimezone(ZoneInfo(asistencia["zona"]))
        dia = ("lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo")[local.weekday()]
        hora = local.strftime("%H:%M")
        return any(
            re.fullmatch(r"(?:[01][0-9]|2[0-3]):[0-5][0-9]-(?:[01][0-9]|2[0-3]):[0-5][0-9]", franja)
            and franja[:5] <= hora < franja[6:]
            for franja in asistencia["horario"].get(dia, [])
        )
    except (KeyError, TypeError, ValueError, AttributeError, OSError):
        return False


class MotorTelefonico:
    """Estado opaco en memoria del worker; ninguna credencial global en el job."""
    HOST = "agente-restaurante-git-migrac-db4675-reservas-projects-46f41d07.vercel.app"

    def __init__(self, datos, http, terminado=None, *, url=None, transferir=None):
        # La URL con bypass es un secreto del worker, nunca metadata del job.
        url = url if url is not None else os.getenv("CONTACTIA_TELEFONO_MOTOR_URL", "")
        u = urlparse(url)
        q = parse_qs(u.query)
        ttl = 300000 if datos.get("canal") == "sip" else 180000
        if (datos.get("version") != 1 or datos.get("host") != self.HOST
                or u.scheme != "https" or u.netloc != self.HOST
                or u.path != "/api/restaurante" or u.fragment
                or q.get("canal") != ["telefono_motor"]
                or set(q) - {"canal", "x-vercel-protection-bypass"}
                or not isinstance(datos.get("exp"), (int, float))
                or not time.time() * 1000 < datos["exp"] <= time.time() * 1000 + ttl
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
        self.sip = datos.get("canal") == "sip"
        nombre = datos.get("nombreRestaurante")
        self.nombre_restaurante = (
            nombre.removesuffix(" (PRUEBA)")
            if self.sip and isinstance(nombre, str) and nombre.strip()
            else "Restaurante Sol"
        )
        self.asistencia = datos.get("asistencia") if self.sip and isinstance(datos.get("asistencia"), dict) else {}
        self.transferir = transferir
        self.paso_motor = None
        self.reintento_ofrecido = False
        self.fase_asistencia = None
        self.respuesta_final = None

    def _responder(self, respuesta, paso=""):
        if paso == "terminado":
            self.respuesta_final = respuesta
            self.cerrada = True
            if self.terminado:
                self.terminado()
        return json.dumps({"respuesta": respuesta[:4000], "paso": paso}, ensure_ascii=False)

    def _despedir(self, extra=""):
        return self._responder(extra + "Disculpe las molestias. Gracias por llamar. Que tenga un buen día.", "terminado")

    def _dar_telefono(self, prefijo="", *, repeticion=False):
        publico = self.asistencia.get("publico")
        if not _numero_asistencia(publico):
            return self._despedir(prefijo + "Contacte con el restaurante para comprobar la reserva antes de hacer otra. ")
        self.fase_asistencia = "repetir"
        digitos = ", ".join(publico[3:] if publico.startswith("+34") else publico[1:])
        if not publico.startswith("+34"):
            digitos = "más " + digitos
        if repeticion:
            prefijo = "Se lo repito: "
        elif prefijo:
            prefijo += "puede llamar al "
        return self._responder(prefijo + digitos + ". ¿Necesita que le repita el número?", "asistencia")

    def _transferencia_disponible(self):
        return bool(self.transferir and _numero_asistencia(self.asistencia.get("destino")) and _en_horario(self.asistencia))

    def esperando_repeticion_telefono(self):
        return self.sip and not self.cerrada and self.fase_asistencia == "repetir"

    def _ofrecer_asistencia(self):
        aviso = "Sigo sin poder comprobar si la reserva se ha realizado. "
        if self._transferencia_disponible():
            self.fase_asistencia = "transferir"
            _registro_transferencia("oferta")
            return self._responder(aviso + "¿Quiere que intente pasarle con el personal del restaurante para comprobarlo?", "asistencia")
        return self._dar_telefono(aviso + "Para comprobar si se ha registrado antes de hacer otra, ")

    async def _atender_asistencia(self, texto):
        si = texto in ("si", "si por favor", "por favor", "si quiero", "si repitalo", "repitalo")
        no = texto in ("no", "no gracias", "no hace falta", "no es necesario")
        if self.fase_asistencia == "repetir":
            repetir = bool(re.fullmatch(
                r"(?:si )?(?:por favor )?(?:me lo )?(?:(?:puede|podria|que) )?(?:me lo )?"
                r"(?:repetir(?:lo)?|repite|repita(?:lo|me)?)(?: (?:el numero|el telefono|por favor|otra vez))*",
                texto,
            ))
            if no or texto in ("no lo necesito", "ya lo tengo", "no ya lo tengo", "no gracias ya lo tengo",
                               "no hace falta gracias", "no no hace falta"):
                return self._despedir()
            if si or repetir or texto in ("claro", "vale", "si claro"):
                return self._dar_telefono(repeticion=True)
            return self._responder("¿Necesita que le repita el número? Diga sí o no.", "asistencia")
        _registro_transferencia("respuesta_cliente", decision="si" if si else "no" if no else "no_reconocida")
        if no:
            return self._dar_telefono("Para comprobar si la reserva se ha registrado antes de hacer otra, ")
        if not si:
            return self._responder("¿Quiere que intente pasarle la llamada? Diga sí o no.", "asistencia")
        if self._transferencia_disponible():
            try:
                await self.transferir(self.asistencia["destino"])
            except asyncio.CancelledError:
                _registro_transferencia("resultado", estado="cancelada")
                raise
            except Exception as error:
                codigo = getattr(error, "code", None)
                if codigo not in ("canceled", "unknown", "invalid_argument", "malformed",
                                   "deadline_exceeded", "not_found", "bad_route", "already_exists",
                                   "permission_denied", "unauthenticated", "resource_exhausted",
                                   "failed_precondition", "aborted", "out_of_range", "unimplemented",
                                   "internal", "unavailable", "data_loss"):
                    codigo = None
                _registro_transferencia("resultado",
                                        estado="tiempo_agotado" if isinstance(error, asyncio.TimeoutError) else "error",
                                        codigo=codigo)
                # Nunca divulgar el destino interno, ni intentar la transferencia otra vez.
                return self._dar_telefono("No he podido pasarle la llamada. Para comprobar si la reserva se ha registrado antes de hacer otra, ")
            _registro_transferencia("resultado", estado="aceptada_api")
            self.fase_asistencia = "transferida"
            self.cerrada = True
            self.respuesta_final = ""
            return self._responder("", "transferida")
        _registro_transferencia("resultado", estado="no_disponible")
        return self._dar_telefono("No puedo pasarle la llamada en este momento. Para comprobar la reserva antes de hacer otra, ")

    async def enviar(self, mensaje):
        async with self.lock:
            if self.cerrada:
                return self._responder(self.respuesta_final or "", "transferida" if self.fase_asistencia == "transferida" else "cerrada")
            texto = " ".join(re.findall(r"[a-z0-9]+", unicodedata.normalize("NFD", mensaje.casefold())
                                       .encode("ascii", "ignore").decode()))
            if self.fase_asistencia:
                return await self._atender_asistencia(texto)
            confirmando = self.sip and (self.paso_motor == "pendiente" or self.reintento_ofrecido)
            if confirmando:
                if texto in ("no", "no gracias"):
                    return self._ofrecer_asistencia()
                if texto not in ("reintentar", "reintente", "volver a intentar", "compruebe", "comprobar", "si", "si por favor"):
                    return self._responder("¿Quiere que lo compruebe de nuevo? Diga «reintentar» o «no».", "pendiente")
            if self.pendiente is not None and not confirmando and mensaje.strip().lower().rstrip(".!? ") not in ("reintentar", "sí", "si"):
                return json.dumps({"respuesta": "El resultado anterior está pendiente. Diga reintentar para comprobarlo sin crear otra reserva."})
            # Si se pierde la respuesta, conservar exactamente el turno y token
            # anteriores. El UUID de reserva del servidor tampoco cambia.
            turno = self.pendiente if self.pendiente is not None else ("reintentar" if confirmando else mensaje)
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
                self.paso_motor = d.get("paso", "")
                if self.sip and self.paso_motor == "pendiente":
                    if confirmando:
                        return self._ofrecer_asistencia()
                    self.reintento_ofrecido = True
                else:
                    self.reintento_ofrecido = False
                return self._responder(d["respuesta"], self.paso_motor)
            except Exception:
                if confirmando:
                    return self._ofrecer_asistencia()
                if self.sip and self.paso_motor == "final" and _confirma_reserva(texto):
                    self.reintento_ofrecido = True
                    return self._responder("Por problemas técnicos no he podido comprobar si la reserva se ha realizado. Si quiere que lo compruebe de nuevo, diga «reintentar».", "pendiente")
                return json.dumps({"respuesta": "No he podido comprobar el resultado. Diga reintentar para comprobarlo sin duplicar la reserva."}, ensure_ascii=False)


def url_motor():
    url = os.getenv("CONTACTIA_TELEFONO_MOTOR_URL", "")
    u = urlparse(url)
    q = parse_qs(u.query)
    if (u.scheme != "https" or u.netloc != MotorTelefonico.HOST
            or u.path != "/api/restaurante" or u.fragment
            or q.get("canal") != ["telefono_motor"]
            or set(q) - {"canal", "x-vercel-protection-bypass"}):
        raise ValueError("URL del motor no válida")
    return url


class ErrorInicioSIP(ValueError):
    def __init__(self, etapa, status=None):
        super().__init__(etapa)
        self.etapa = etapa
        self.status = status


async def iniciar_sip(room, identity, http):
    # Una clave propia compartida con Vercel firma el inicio; nunca va en metadata.
    try:
        url = url_motor().replace("canal=telefono_motor", "canal=telefono_sip_inicio")
    except ValueError:
        raise ErrorInicioSIP("configuracion_url") from None
    timestamp = int(time.time() * 1000)
    secreto = os.getenv("CONTACTIA_SIP_WORKER_SECRET", "")
    if len(secreto) < 32:
        raise ErrorInicioSIP("configuracion_clave_compartida")
    datos = {"room": room, "identity": identity, "timestamp": timestamp}
    canon = json.dumps([room, identity, timestamp], separators=(",", ":"), ensure_ascii=False)
    firma = hmac.new(secreto.encode(), ("contactia:sip:inicio:v1:" + canon).encode(), hashlib.sha256).hexdigest()
    async with http.post(url, headers={"X-Contactia-Sip-Signature": firma},
                         json=datos, allow_redirects=False) as r:
        if r.status != 200:
            raise ErrorInicioSIP("respuesta_http", r.status)
        respuesta = await r.json()
    if respuesta.get("ok") is not True or respuesta.get("room") != room or respuesta.get("identity") != identity:
        raise ErrorInicioSIP("respuesta_invalida")
    return respuesta


async def transferir_sip(room, identity, destino):
    solicitud = api.TransferSIPParticipantRequest(
        room_name=room, participant_identity=identity,
        transfer_to="tel:" + destino, play_dialtone=True)
    solicitud.ringing_timeout.seconds = 10
    async with api.LiveKitAPI() as lk:
        _registro_transferencia("solicitud")
        await asyncio.wait_for(lk.sip.transfer_sip_participant(solicitud), timeout=13)


async def contactia_telefono(ctx: JobContext):
    # Un solo rtc_session por AgentServer. Las salas telefónicas y su metadata
    # privada seleccionan el transporte; las salas web conservan su RPC.
    datos = json.loads(ctx.job.metadata or "{}")
    await ctx.connect()
    http = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=20))
    ctx.add_shutdown_callback(http.close)
    if ctx.room.name.startswith("contactia-telefono-sol-"):
        try:
            participante = await asyncio.wait_for(ctx.wait_for_participant(
                kind=rtc.ParticipantKind.PARTICIPANT_KIND_SIP), timeout=25)
            datos = await iniciar_sip(ctx.room.name, participante.identity, http)
        except Exception as error:
            # No imprimir el mensaje de la excepción: puede contener URL o tokens.
            print(json.dumps({"tipo": "contactia_sip_inicio_error",
                              "etapa": getattr(error, "etapa", "conexion_o_participante"),
                              "http_status": getattr(error, "status", None),
                              "clase": type(error).__name__}))
            async with api.LiveKitAPI() as lk:
                await lk.room.delete_room(api.DeleteRoomRequest(room=ctx.room.name))
            ctx.shutdown(reason="Entrada SIP no autorizada")
            return
    elif datos.get("room") != ctx.room.name:
        ctx.shutdown(reason="Conexión no válida")
        return
    else:
        participante = await asyncio.wait_for(ctx.wait_for_participant(
            identity=datos.get("identity"),
            kind=rtc.ParticipantKind.PARTICIPANT_KIND_CONNECTOR), timeout=25)
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
    async def transferir(destino):
        if time.time() * 1000 + 15000 >= datos["exp"]:
            _registro_transferencia("bloqueada", motivo="limite_llamada")
            raise RuntimeError("No queda tiempo para transferir")
        await transferir_sip(ctx.room.name, participante.identity, destino)
    relay = MotorTelefonico(datos,http,terminado=lambda: lanzar(cierre_final()),
                            transferir=transferir if datos.get("canal") == "sip" else None)
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
