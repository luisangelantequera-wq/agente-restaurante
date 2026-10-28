"""Pruebas sin red, micrófono, modelos ni credenciales de proveedor."""
import asyncio
import importlib.util
import json
from pathlib import Path
import sys
import time
import types
import unittest
from unittest.mock import patch


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
    agentes.Agent = AgenteFalso
    agentes.AgentServer = ServidorFalso
    agentes.function_tool = lambda: lambda f: f
    agentes.cli = agentes.inference = types.SimpleNamespace()
    lk = types.ModuleType("livekit")
    lk.rtc = types.SimpleNamespace(ParticipantKind=types.SimpleNamespace(
        PARTICIPANT_KIND_STANDARD=0, PARTICIPANT_KIND_CONNECTOR=5))
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
    def test_un_registro_y_destinos_fijos(self):
        self.assertEqual(len(m.server.registros), 1)
        for cambio in ({"host": "otro.example"}, {"exp": 1}, {"exp": time.time()*1000+360000}, {"acceso": None}):
            with self.assertRaises(ValueError):
                m.MotorTelefonico({**datos(), **cambio}, None, url=URL)
        for url in ("https://otro.example/api/restaurante?canal=telefono_motor", URL.replace("https:", "http:"), ""):
            with self.assertRaises(ValueError):
                m.MotorTelefonico(datos(), None, url=url)

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


if __name__ == "__main__":
    unittest.main()
