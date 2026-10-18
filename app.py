
from flask import Flask, render_template, jsonify
import psutil
import platform
from datetime import datetime, timezone

app = Flask(__name__)


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
    disk = psutil.disk_usage("C:\\")
    network = psutil.net_io_counters()

    return jsonify({
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "host": platform.node(),
        "platform": platform.system(),
        "cpu": {
            "usage_percent": psutil.cpu_percent(interval=0.5),
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


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
