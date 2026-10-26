"""SportsEvent: horas de la jornada y organizador."""
import unittest

from test_cx_pages import offline_helpers


class StageEventBoundsTest(unittest.TestCase):
    def setUp(self):
        self.bounds = offline_helpers("tools/site/gen_og_pages.py")["stage_event_bounds"]

    def test_usa_salida_y_llegada_con_hora(self):
        rd = {"neutralStartTimeUtc": "2027-05-08T11:05:00+00:00",
              "estimatedFinishTimeUtc": "2027-05-08T15:30:00+00:00"}
        self.assertEqual(self.bounds(rd, "2027-05-08"),
                         ("2027-05-08T11:05:00+00:00", "2027-05-08T15:30:00+00:00"))

    def test_sin_llegada_termina_en_la_salida(self):
        rd = {"neutralStartTimeUtc": "2027-05-08T11:05:00+00:00", "estimatedFinishTimeUtc": None}
        self.assertEqual(self.bounds(rd, "2027-05-08"),
                         ("2027-05-08T11:05:00+00:00", "2027-05-08T11:05:00+00:00"))

    def test_sin_horas_usa_la_fecha(self):
        self.assertEqual(self.bounds({}, "2027-05-08"), ("2027-05-08", "2027-05-08"))
        self.assertEqual(self.bounds({"neutralStartTimeUtc": None}, ""), (None, None))


class OrganizerTest(unittest.TestCase):
    def setUp(self):
        builder = offline_helpers("tools/site/gen_og_pages.py")
        self.event = lambda **extra: builder["sports_event"](
            "Giro", "2027-05-08", "2027-05-08", "https://calendariociclismo.app/jornada/giro/",
            "Etapa", location_name="Bari", location_country="IT", **extra)

    def test_organizador_es_la_carrera_con_su_web(self):
        event = self.event(organizer_name="Giro de Italia", organizer_url="https://www.giroditalia.it/")
        self.assertEqual(event["organizer"], {"@type": "Organization", "name": "Giro de Italia",
                                              "url": "https://www.giroditalia.it/"})

    def test_sin_web_no_hay_organizador(self):
        self.assertNotIn("organizer", self.event(organizer_name="Giro de Italia"))
        self.assertNotIn("organizer", self.event())


if __name__ == "__main__":
    unittest.main()
