
import os
import platform
from datetime import datetime, timezone
from flask import Flask, render_template, jsonify
import psutil

app = Flask(__name__)

# Warm up CPU percent monitoring on startup so calls with interval=None return real telemetry immediately
psutil.cpu_percent(interval=None)


def get_disk_usage():
    """Retrieve disk usage in a platform-independent manner.
    Works seamlessly on Windows, Linux (Ubuntu CI), and containerized environments.
    """
    configured_path = os.getenv("METRICS_DISK_PATH")
    if configured_path:
        target_path = configured_path
    else:
        target_path = "C:\\" if os.name == "nt" else "/"

    try:
        return psutil.disk_usage(target_path)
    except (FileNotFoundError, PermissionError, OSError):
        try:
            return psutil.disk_usage(os.path.abspath(os.sep))
        except Exception:
            return psutil.disk_usage(".")


@app.route("/")
def dashboard():
    return render_template("index.html")


@app.route("/api/health")
def api_health():
    return jsonify({
        "status": "ok",
        "service": "JEMI DevOps Control Center",
        "timestamp": datetime.now(timezone.utc).isoformat()
    })


@app.route("/api/metrics")
def api_metrics():
    memory = psutil.virtual_memory()
    disk = get_disk_usage()
    network = psutil.net_io_counters()

    return jsonify({
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "host": platform.node(),
        "platform": platform.system(),
        "cpu": {
            "usage_percent": psutil.cpu_percent(interval=None),
            "logical_cores": psutil.cpu_count(logical=True)
        },
        "memory": {
            "total_bytes": memory.total,
            "used_bytes": memory.used,
            "usage_percent": memory.percent
        },
        "disk": {
            "total_bytes": disk.total,
            "used_bytes": disk.used,
            "usage_percent": disk.percent
        },
        "network": {
            "bytes_sent": network.bytes_sent,
            "bytes_received": network.bytes_recv
        }
    })


@app.route("/api/incidents")
def api_incidents():
    """Real rule-based incident telemetry endpoint.

    Evaluates live host metrics (CPU, RAM, Storage) and application health against
    DevOps thresholds. Query param ?simulate=<type> is supported for demonstration.
    """
    from flask import request
    from health_service import evaluate_metrics_rules

    simulate = request.args.get("simulate")
    memory = psutil.virtual_memory()
    disk = get_disk_usage()
    cpu = psutil.cpu_percent(interval=None)

    incidents = evaluate_metrics_rules(
        cpu_pct=cpu,
        mem_pct=memory.percent,
        disk_pct=disk.percent,
        health_status="healthy",
        simulate=simulate
    )
    return jsonify(incidents)


@app.route("/api/service-check")
def api_service_check():
    """Application health probe service using health_service module."""
    from flask import request
    from health_service import check_application

    target_url = request.args.get("url")
    if not target_url:
        target_url = f"http://{os.getenv('HOST', '127.0.0.1')}:{os.getenv('PORT', '5000')}/api/health"

    result = check_application(target_url, timeout=2)
    return jsonify(result)


@app.errorhandler(404)
def not_found(error):
    return jsonify({
        "status": "error",
        "error": "Not Found",
        "message": "The requested resource was not found on this server."
    }), 404


@app.errorhandler(500)
def internal_error(error):
    return jsonify({
        "status": "error",
        "error": "Internal Server Error",
        "message": "An unexpected error occurred while processing the request."
    }), 500


if __name__ == "__main__":
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "5000"))
    debug = os.getenv("FLASK_DEBUG", "false").lower() in ("true", "1", "yes")
    app.run(host=host, port=port, debug=debug)
