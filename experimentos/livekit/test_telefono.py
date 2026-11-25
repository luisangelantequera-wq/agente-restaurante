"""Pruebas sin red, micrófono, modelos ni credenciales de proveedor."""
import asyncio
import importlib.util
import json
import hashlib
import hmac
from pathlib import Path
import sys
import time
import types
import unittest
from unittest.mock import AsyncMock, patch


class ServidorFalso:
    def __init__(self):
        self.registros = []

    def rtc_session(self, **opciones):
        def decorar(f):
            if self.registros:
                raise RuntimeError("Solo se permite un rtc_session")
            self.registros.append(opciones)
            return f
        return decorar


class AgenteFalso:
    def __init__(self, **kwargs):
        pass


def cargar():
    agentes = types.ModuleType("livekit.agents")
    for nombre in ("AgentSession", "JobContext", "RunContext"):
        setattr(agentes, nombre, type(nombre, (), {}))
    agentes.StopResponse = type("StopResponse", (Exception,), {})
    agentes.Agent = AgenteFalso
    agentes.AgentServer = ServidorFalso
    agentes.function_tool = lambda: lambda f: f
    agentes.cli = agentes.inference = types.SimpleNamespace()
    lk = types.ModuleType("livekit")
    lk.rtc = types.SimpleNamespace(ParticipantKind=types.SimpleNamespace(
        PARTICIPANT_KIND_STANDARD=0, PARTICIPANT_KIND_CONNECTOR=5, PARTICIPANT_KIND_SIP=3))
    lk.api = types.SimpleNamespace()
    dotenv = types.ModuleType("dotenv")
    dotenv.load_dotenv = lambda _: None
    aiohttp = types.ModuleType("aiohttp")
    with patch.dict(sys.modules, {"livekit": lk, "livekit.agents": agentes,
                                  "dotenv": dotenv, "aiohttp": aiohttp}):
        spec = importlib.util.spec_from_file_location("agente_probado", Path(__file__).with_name("agent.py"))
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        return m


m = cargar()


def datos():
    return {"version": 1, "host": m.MotorTelefonico.HOST,
            "exp": time.time() * 1000 + 179000, "acceso": "pase-ficticio", "conversacion_token": "estado-0"}


URL = "https://" + m.MotorTelefonico.HOST + "/api/restaurante?canal=telefono_motor&x-vercel-protection-bypass=ficticio"


class Respuesta:
    status = 200

    def __init__(self, d):
        self.d = d

    async def __aenter__(self):
        if isinstance(self.d, Exception):
            raise self.d
        return self

    async def __aexit__(self, *_):
        pass

    async def json(self):
        await asyncio.sleep(0)
        return self.d


class HTTP:
    def __init__(self, respuestas):
        self.respuestas = list(respuestas)
        self.peticiones = []

    def post(self, url, **kwargs):
        self.peticiones.append((url, kwargs))
        return Respuesta(self.respuestas.pop(0))


def resultado(token, paso="nombre"):
    return {"ok": True, "conversacion_token": token, "respuesta": "Respuesta del motor", "paso": paso}


class Pruebas(unittest.IsolatedAsyncioTestCase):
    async def test_sip_acepta_si_y_reintentar_y_solo_comprueba_una_vez(self):
        for mensaje in ("Sí.", "Sí, sí", "Sí, quiero", "Reintentar, por favor", "Compruébelo"):
            with self.subTest(mensaje=mensaje):
                d = datos()
                d.update(canal="sip", asistencia={"publico": "+34910000000"})
                http = HTTP([resultado("estado-1", "pendiente")])
                relay = m.MotorTelefonico(d, http, url=URL)
                relay.paso_motor = "pendiente"
                respuesta = json.loads(await relay.enviar(mensaje))
                self.assertEqual(respuesta["paso"], "asistencia")
                self.assertEqual(len(http.peticiones), 1)
                self.assertEqual(http.peticiones[0][1]["json"]["mensaje"], "reintentar")

    async def test_sip_acepta_no_y_limita_las_aclaraciones(self):
        for mensajes in (("No.",), ("No, no, gracias",), ("No quiero",),
                         ("¿Cómo dice?", "No le entiendo")):
            with self.subTest(mensajes=mensajes):
                d = datos()
                d.update(canal="sip", asistencia={"publico": "+34910000000"})
                http = HTTP([])
                relay = m.MotorTelefonico(d, http, url=URL)
                relay.paso_motor = "pendiente"
                for mensaje in mensajes[:-1]:
                    respuesta = json.loads(await relay.enviar(mensaje))
                    self.assertEqual(respuesta["paso"], "pendiente")
                respuesta = json.loads(await relay.enviar(mensajes[-1]))
                self.assertIn("9, 1, 0, 0, 0, 0, 0, 0, 0", respuesta["respuesta"])
                self.assertEqual(respuesta["paso"], "asistencia")
                self.assertEqual(http.peticiones, [])

    async def test_cielo_locuta_la_respuesta_del_motor_sin_invocar_el_llm(self):
        d = datos()
        d.update(canal="sip", ensayoCielo=True, nombreRestaurante="Restaurante Cielo (PRUEBA)")
        relay = m.MotorTelefonico(d, HTTP([]), url=URL)
        agente = m.RecepcionistaPrueba(None, "telefono", relay)
        locuciones = []
        agente.session = types.SimpleNamespace(say=locuciones.append)
        respuesta = "Puede elegir Interior o Terraza. ¿En qué zona prefiere reservar?"
        with patch.object(relay, "enviar", AsyncMock(return_value=json.dumps(
                {"respuesta": respuesta, "paso": "zona"}))) as enviar:
            with self.assertRaises(m.StopResponse):
                await agente.on_user_turn_completed(None, types.SimpleNamespace(text_content=" Dos personas "))
            enviar.assert_awaited_once_with("Dos personas")
        self.assertEqual(locuciones, [respuesta])

    async def test_cielo_da_una_respuesta_si_el_motor_devuelve_texto_vacio(self):
        d = datos()
        d.update(canal="sip", ensayoCielo=True)
        relay = m.MotorTelefonico(d, HTTP([]), url=URL)
        agente = m.RecepcionistaPrueba(None, "telefono", relay)
        locuciones = []
        agente.session = types.SimpleNamespace(say=locuciones.append)
        with patch.object(relay, "enviar", AsyncMock(return_value=json.dumps(
                {"respuesta": "", "paso": "zona"}))):
            with self.assertRaises(m.StopResponse):
                await agente.on_user_turn_completed(None, types.SimpleNamespace(text_content="Terraza"))
        self.assertEqual(locuciones, ["No he podido completar esta operación. ¿Puede repetirlo?"])

    def test_un_registro_y_destinos_fijos(self):
        self.assertEqual(len(m.server.registros), 1)
        for cambio in ({"host": "otro.example"}, {"exp": 1}, {"exp": time.time()*1000+360000}, {"acceso": None}):
            with self.assertRaises(ValueError):
                m.MotorTelefonico({**datos(), **cambio}, None, url=URL)
        for url in ("https://otro.example/api/restaurante?canal=telefono_motor", URL.replace("https:", "http:"), ""):
            with self.assertRaises(ValueError):
                m.MotorTelefonico(datos(), None, url=url)

    def test_sip_admite_cinco_minutos_y_conector_conserva_tres(self):
        d = {**datos(), "exp": time.time()*1000+299000, "canal": "sip"}
        m.MotorTelefonico(d, None, url=URL)
        with self.assertRaises(ValueError):
            m.MotorTelefonico({**d, "canal": "conector"}, None, url=URL)
        with self.assertRaises(ValueError):
            m.MotorTelefonico({**d, "exp": time.time()*1000+301000}, None, url=URL)

    async def test_turnos_serializados_y_estado_opaco(self):
        http = HTTP([resultado("estado-1"), resultado("estado-2")])
        relay = m.MotorTelefonico(datos(), http, url=URL)
        await asyncio.gather(relay.enviar("Antonio"), relay.enviar("pepito arroba gmail punto com"))
        self.assertEqual([p[1]["json"]["conversacion_token"] for p in http.peticiones], ["estado-0", "estado-1"])
        self.assertFalse(http.peticiones[0][1]["allow_redirects"])
        self.assertEqual(http.peticiones[0][1]["headers"]["Authorization"], "Bearer pase-ficticio")

    async def test_respuesta_perdida_conserva_turno_y_estado(self):
        http = HTTP([TimeoutError(), resultado("estado-confirmado", "terminado")])
        finales = []
        relay = m.MotorTelefonico(datos(), http, terminado=lambda: finales.append(True), url=URL)
        r = json.loads(await relay.enviar("Sí"))
        self.assertIn("reintentar", r["respuesta"])
        await relay.enviar("cambie mi nombre")
        self.assertEqual(len(http.peticiones), 1)
        await relay.enviar("reintentar")
        self.assertEqual(http.peticiones[0][1]["json"], http.peticiones[1][1]["json"])
        self.assertEqual(finales, [True])
        await relay.enviar("Sí")
        self.assertEqual(len(http.peticiones), 2)

    async def test_sip_transfiere_solo_tras_un_reintento_y_con_permiso(self):
        d = {**datos(), "canal": "sip", "asistencia": {
            "publico": "+34910000001", "destino": "+34600000002"}}
        http = HTTP([resultado("pendiente-1", "pendiente"), resultado("pendiente-2", "pendiente")])
        transferencia = AsyncMock()
        relay = m.MotorTelefonico(d, http, url=URL, transferir=transferencia)
        with patch.object(m, "_en_horario", return_value=True):
            self.assertEqual(json.loads(await relay.enviar("Sí"))["paso"], "pendiente")
            oferta = await relay.enviar("reintentar")
            self.assertIn("¿Quiere que intente pasarle", oferta)
            self.assertNotIn("600000002", oferta)
            await relay.enviar("Sí, pero no me pase")
            transferencia.assert_not_awaited()
            self.assertEqual(json.loads(await relay.enviar("Sí, por favor"))["paso"], "transferida")
            self.assertEqual(json.loads(await relay.enviar("sí"))["respuesta"], "")
        transferencia.assert_awaited_once_with("+34600000002")
        self.assertEqual(len(http.peticiones), 2)

    async def test_livekit_recibe_la_sala_el_participante_y_el_destino_correctos(self):
        peticion = types.SimpleNamespace(ringing_timeout=types.SimpleNamespace(seconds=0))
        enviar = AsyncMock()
        cliente = AsyncMock()
        cliente.__aenter__.return_value = types.SimpleNamespace(sip=types.SimpleNamespace(transfer_sip_participant=enviar))
        with patch.object(m.api, "LiveKitAPI", return_value=cliente, create=True), patch.object(
            m.api, "TransferSIPParticipantRequest", return_value=peticion, create=True
        ) as construir:
            await m.transferir_sip("sala-de-prueba", "sip-cliente", "+34600000002")
        construir.assert_called_once_with(room_name="sala-de-prueba", participant_identity="sip-cliente",
                                          transfer_to="tel:+34600000002", play_dialtone=True)
        enviar.assert_awaited_once_with(peticion)
        self.assertEqual(peticion.ringing_timeout.seconds, 10)

    async def test_sip_fallo_de_red_repite_el_mismo_turno_y_dicta_numero_si_falla_transferencia(self):
        d = {**datos(), "canal": "sip", "asistencia": {
            "publico": "+34910000001", "destino": "+34600000002"}}
        http = HTTP([resultado("en-final", "final"), TimeoutError(), TimeoutError()])
        transferencia = AsyncMock(side_effect=RuntimeError("No contesta"))
        cierres = []
        relay = m.MotorTelefonico(d, http, url=URL, transferir=transferencia, terminado=lambda: cierres.append(True))
        with patch.object(m, "_en_horario", return_value=True):
            await relay.enviar("Ninguna")
            self.assertIn("reintentar", await relay.enviar("Confirmo los datos"))
            self.assertIn("pasarle", await relay.enviar("reintentar"))
            respuesta = json.loads(await relay.enviar("Sí"))["respuesta"]
            self.assertIn("No he podido pasarle la llamada", respuesta)
            self.assertIn("9, 1, 0, 0, 0, 0, 0, 0, 1", respuesta)
            self.assertNotIn("6, 0, 0", respuesta)
            for _ in range(2):
                self.assertIn("¿Necesita que le repita el número?", await relay.enviar("Sí"))
            self.assertIn("Disculpe las molestias", await relay.enviar("No, gracias"))
        self.assertEqual(cierres, [True])
        transferencia.assert_awaited_once()
        self.assertEqual(len(http.peticiones), 3)
        self.assertEqual(http.peticiones[1][1]["json"], http.peticiones[2][1]["json"])

    async def test_sip_fuera_de_horario_sin_horario_y_cambio_de_franja(self):
        antes = m.datetime.fromisoformat("2026-11-23T10:00:00+00:00")
        limite = m.datetime.fromisoformat("2026-11-23T12:00:00+00:00")
        en_horario = m._en_horario
        for horario, instante in (({}, antes), ({"lunes": ["11:00-13:00"]}, limite), ({"lunes": ["11:00-13:00"]}, antes)):
            d = {**datos(), "canal": "sip", "asistencia": {"zona": "Europe/Madrid", "horario": horario,
                 "publico": "+34910000001", "destino": "+34600000002"}}
            transferencia = AsyncMock()
            http = HTTP([resultado("pendiente-1", "pendiente"), resultado("pendiente-2", "pendiente")])
            relay = m.MotorTelefonico(d, http, url=URL, transferir=transferencia)
            with patch.object(m, "_en_horario", side_effect=lambda a: en_horario(a, instante)):
                await relay.enviar("Sí")
                r = await relay.enviar("reintentar")
                if instante == antes and horario:
                    self.assertIn("¿Quiere que intente pasarle", r)
                    instante = limite
                    r = await relay.enviar("Sí")
                self.assertIn("puede llamar al", r)
                self.assertNotIn("cerrado", r)
            transferencia.assert_not_awaited()

    async def test_web_conserva_rpc_y_telefono_usa_motor(self):
        class Local:
            async def perform_rpc(self, **kwargs):
                self.kwargs = kwargs
                return json.dumps({"respuesta": "¿Qué día?", "paso": "fecha"})
        local = Local()
        ctx = types.SimpleNamespace(room=types.SimpleNamespace(local_participant=local))
        agente = m.RecepcionistaPrueba(ctx, "navegador")
        await agente.procesar_turno_contactia(None, "Sí")
        self.assertEqual(json.loads(local.kwargs["payload"]), {"mensaje": "Sí"})
        http = HTTP([resultado("estado-1")])
        agente = m.RecepcionistaPrueba(ctx, "telefono", m.MotorTelefonico(datos(), http, url=URL))
        await agente.procesar_turno_contactia(None, "A las dos")
        self.assertEqual(http.peticiones[0][1]["json"]["mensaje"], "A las dos")

    async def test_sip_firma_inicio_sin_secretos_en_metadata(self):
        room, identity = "contactia-telefono-sol-ficticia", "sip_ficticio"
        http = HTTP([{"ok": True, "room": room, "identity": identity, **datos()}])
        secreto = "secreto-compartido-sip-ficticio-000000"
        with patch.dict(m.os.environ, {"CONTACTIA_TELEFONO_MOTOR_URL": URL, "CONTACTIA_SIP_WORKER_SECRET": secreto, "LIVEKIT_API_SECRET": "otra-credencial-cloud"}):
            r = await m.iniciar_sip(room, identity, http)
        url, p = http.peticiones[0]
        self.assertIn("canal=telefono_sip_inicio", url)
        self.assertFalse(p["allow_redirects"])
        b = p["json"]
        canon = json.dumps([room, identity, b["timestamp"]], separators=(",", ":"))
        esperado = hmac.new(secreto.encode(), ("contactia:sip:inicio:v1:"+canon).encode(), hashlib.sha256).hexdigest()
        self.assertEqual(p["headers"]["X-Contactia-Sip-Signature"], esperado)
        self.assertNotIn(secreto, json.dumps(b))
        self.assertEqual(r["room"], room)

    async def test_sip_rechaza_redireccion_y_respuesta_de_otra_sala(self):
        with patch.dict(m.os.environ, {"CONTACTIA_TELEFONO_MOTOR_URL": URL, "CONTACTIA_SIP_WORKER_SECRET": "ficticio-compartido-sip-secret-000000"}):
            for d in ({"ok": False}, {"ok": True, "room": "otra", "identity": "sip"}):
                with self.assertRaises(ValueError):
                    await m.iniciar_sip("contactia-telefono-sol-ficticia", "sip", HTTP([d]))
        with patch.dict(m.os.environ, {"CONTACTIA_TELEFONO_MOTOR_URL": "https://otro.example/api/restaurante?canal=telefono_motor"}):
            http = HTTP([])
            with self.assertRaises(ValueError):
                await m.iniciar_sip("contactia-telefono-sol-ficticia", "sip", http)
            self.assertEqual(http.peticiones, [])

    async def test_entrada_sip_elige_participante_sip_y_motor_sin_metadata(self):
        from unittest.mock import AsyncMock
        room = "contactia-telefono-sol-ficticia"
        participante = types.SimpleNamespace(identity="sip_ficticio")
        callbacks = []
        ctx = types.SimpleNamespace(room=types.SimpleNamespace(name=room), job=types.SimpleNamespace(metadata=""),
            connect=AsyncMock(), wait_for_participant=AsyncMock(return_value=participante), add_shutdown_callback=callbacks.append)
        http = types.SimpleNamespace(close=AsyncMock())
        session = types.SimpleNamespace(on=lambda _: lambda f: f)
        inicio = AsyncMock(return_value={**datos(), "room": room, "identity": participante.identity})
        sesion = AsyncMock(return_value=session)
        with patch.object(m.aiohttp, "ClientSession", return_value=http, create=True), patch.object(m.aiohttp, "ClientTimeout", create=True), patch.object(m, "iniciar_sip", inicio), patch.object(m, "iniciar_sesion", sesion), patch.dict(m.os.environ, {"CONTACTIA_TELEFONO_MOTOR_URL": URL}):
            await m.contactia_telefono(ctx)
            ctx.wait_for_participant.assert_awaited_once_with(kind=3)
            inicio.assert_awaited_once_with(room, participante.identity, http)
            self.assertIsInstance(sesion.call_args.args[2], m.MotorTelefonico)
            for callback in callbacks:
                await callback()


if __name__ == "__main__":
    unittest.main()
