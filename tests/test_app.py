import os
import unittest
from app import app, get_disk_usage
from health_service import check_application, evaluate_metrics_rules


class JemiAppTests(unittest.TestCase):
    def setUp(self):
        app.config["TESTING"] = True
        self.client = app.test_client()

    def test_dashboard_loads(self):
        """Verify the homepage renders HTTP 200 with JEMI HUD markup."""
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        html = response.get_data(as_text=True)
        self.assertIn("DEVOPS CONTROL CENTER", html)
        self.assertIn("jemi.css", html)
        self.assertIn("jemi.js", html)

    def test_health_endpoint(self):
        """Verify /api/health returns healthy status and service signature."""
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)

        data = response.get_json()
        self.assertEqual(data["status"], "ok")
        self.assertEqual(data["service"], "JEMI DevOps Control Center")
        self.assertIn("timestamp", data)

    def test_metrics_endpoint(self):
        """Verify /api/metrics returns structured telemetry matching schema."""
        response = self.client.get("/api/metrics")
        self.assertEqual(response.status_code, 200)

        data = response.get_json()
        self.assertIn("cpu", data)
        self.assertIn("usage_percent", data["cpu"])
        self.assertIn("logical_cores", data["cpu"])

        self.assertIn("memory", data)
        self.assertIn("total_bytes", data["memory"])
        self.assertIn("used_bytes", data["memory"])
        self.assertIn("usage_percent", data["memory"])

        self.assertIn("disk", data)
        self.assertIn("total_bytes", data["disk"])
        self.assertIn("used_bytes", data["disk"])
        self.assertIn("usage_percent", data["disk"])

        self.assertIn("network", data)
        self.assertIn("bytes_sent", data["network"])
        self.assertIn("bytes_received", data["network"])

        self.assertIn("platform", data)
        self.assertIn("host", data)
        self.assertIn("timestamp", data)

    def test_metrics_platform_independence(self):
        """Verify get_disk_usage works even if path is non-existent (Linux fallback)."""
        original_env = os.environ.get("METRICS_DISK_PATH")
        try:
            # Point to non-existent path to trigger cross-platform fallback handler
            os.environ["METRICS_DISK_PATH"] = "/invalid/test/path/nonexistent"
            usage = get_disk_usage()
            self.assertIsNotNone(usage)
            self.assertGreater(usage.total, 0)
            self.assertGreaterEqual(usage.percent, 0.0)
        finally:
            if original_env is not None:
                os.environ["METRICS_DISK_PATH"] = original_env
            else:
                os.environ.pop("METRICS_DISK_PATH", None)

    def test_incidents_endpoint_real_telemetry(self):
        """Verify /api/incidents returns a list with rule-evaluated incidents."""
        response = self.client.get("/api/incidents")
        self.assertEqual(response.status_code, 200)

        data = response.get_json()
        self.assertIsInstance(data, list)
        self.assertGreater(len(data), 0)

        first = data[0]
        self.assertIn("id", first)
        self.assertIn("severity", first)
        self.assertIn("title", first)
        self.assertIn("service", first)
        self.assertIn("status", first)
        self.assertIn("detected", first)

    def test_incidents_simulation_parameter(self):
        """Verify ?simulate=cpu_critical returns clearly labeled demonstration incident."""
        response = self.client.get("/api/incidents?simulate=cpu_critical")
        self.assertEqual(response.status_code, 200)

        data = response.get_json()
        self.assertIsInstance(data, list)
        self.assertGreater(len(data), 0)
        critical_incident = next((i for i in data if i["severity"] == "critical"), None)
        self.assertIsNotNone(critical_incident)
        self.assertIn("DEMO SIMULATION", critical_incident["title"])
        self.assertEqual(critical_incident["status"], "active")
        self.assertEqual(critical_incident["source"], "simulated")

    def test_service_check_endpoint(self):
        """Verify /api/service-check can probe the local health endpoint."""
        response = self.client.get("/api/service-check")
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertIn("url", data)
        self.assertIn("status", data)

    def test_error_handling_404(self):
        """Verify nonexistent route returns structured JSON 404 error."""
        response = self.client.get("/api/route-that-does-not-exist")
        self.assertEqual(response.status_code, 404)
        data = response.get_json()
        self.assertEqual(data["status"], "error")
        self.assertEqual(data["error"], "Not Found")

    def test_health_service_unreachable_endpoint(self):
        """Verify check_application gracefully handles unreachable endpoints."""
        res = check_application("http://127.0.0.1:59998/offline", timeout=0.5)
        self.assertEqual(res["status"], "unavailable")
        self.assertIn("error", res)
        self.assertIn("checked_at", res)

    def test_evaluate_metrics_rules_thresholds(self):
        """Unit test rule evaluation boundaries for CPU, RAM, and Disk."""
        # Baseline normal
        normal = evaluate_metrics_rules(cpu_pct=25.0, mem_pct=50.0, disk_pct=60.0)
        self.assertEqual(len(normal), 1)
        self.assertEqual(normal[0]["severity"], "info")
        self.assertEqual(normal[0]["status"], "resolved")

        # Warning threshold CPU >= 75%
        cpu_warn = evaluate_metrics_rules(cpu_pct=78.0, mem_pct=50.0, disk_pct=60.0)
        self.assertTrue(any(i["severity"] == "warning" and i["service"] == "Compute Subsystem" for i in cpu_warn))

        # Critical threshold CPU >= 90%
        cpu_crit = evaluate_metrics_rules(cpu_pct=92.0, mem_pct=50.0, disk_pct=60.0)
        self.assertTrue(any(i["severity"] == "critical" and i["service"] == "Compute Subsystem" for i in cpu_crit))

        # Critical Memory >= 90%
        mem_crit = evaluate_metrics_rules(cpu_pct=30.0, mem_pct=94.0, disk_pct=60.0)
        self.assertTrue(any(i["severity"] == "critical" and i["service"] == "Memory Subsystem" for i in mem_crit))


if __name__ == "__main__":
    unittest.main()
