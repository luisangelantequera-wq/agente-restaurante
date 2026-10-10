"""Agente de voz experimental: no se despliega en Vercel.

Ejecutar en un servidor/worker LiveKit separado. No almacena audio ni
transcripciones en archivos. Las políticas de retención de proveedores
deben verificarse por separado antes de usar datos reales.
"""
import json
import os
import time

from livekit.agents import Agent, AgentServer, AgentSession, JobContext, RunContext, cli, function_tool, inference

AGENT_NAME = "contactia-cartesia-prueba"
server = AgentServer()


class RecepcionistaPrueba(Agent):
    def __init__(self, ctx: JobContext, browser_identity: str):
        super().__init__(instructions=(
            "Es usted el recepcionista de Restaurante Sol en una prueba privada. "
            "Hable en español peninsular de forma breve, natural y siempre de usted. "
            "El sistema Contactia es el único que decide horarios, disponibilidad, "
            "retenciones, confirmaciones y cancelaciones. "
            "En cada intervención nueva del cliente invoque procesar_turno_contactia "
            "una sola vez con el contenido fiel de la intervención. "
            "Nunca invente disponibilidad ni confirme una reserva por su cuenta. "
            "Espere al resultado de la herramienta y comunique solo su campo respuesta, "
            "sin agregar ni alterar horas, fechas, personas, nombres o localizadores. "
            "No solicite datos personales reales: esta sesión es de prueba y "
            "debe usarse exclusivamente con datos ficticios. "
            "Si hay un fallo técnico, indique que no ha podido completar la operación."
        ))
        self.ctx = ctx
        self.browser_identity = browser_identity

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
    await ctx.connect()
    # Las salas son privadas, de un solo cliente. Se espera al navegador.
    browser = await ctx.wait_for_participant()
    session = AgentSession(
        stt=inference.STT(model="deepgram/nova-3", language="es"),
        llm=inference.LLM(model="openai/gpt-4.1-mini"),
        tts=inference.TTS(model="rime/coda", voice="lark", language="es"),
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
        agent=RecepcionistaPrueba(ctx, browser.identity),
        room=ctx.room,
        record=False,  # Desactivar audio, transcripciones, trazas y logs en Agent Insights.
    )
    await session.say(
        "Bienvenido a Restaurante Sol. Esta es una prueba con datos ficticios. "
        "¿Desea hacer una reserva?"
    )


if __name__ == "__main__":
    cli.run_app(server)
