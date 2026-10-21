
import time
from datetime import datetime, timezone
from urllib.request import urlopen
from urllib.error import URLError, HTTPError


def check_application(url, timeout=3):
    """Probe an HTTP endpoint and return health, status code, and latency in ms."""
    checked_at = datetime.now(timezone.utc).isoformat()
    start = time.perf_counter()

    try:
        with urlopen(url, timeout=timeout) as response:
            status_code = response.status

        return {
            "url": url,
            "status": "healthy" if 200 <= status_code < 400 else "unhealthy",
            "http_status": status_code,
            "response_time_ms": round(
                (time.perf_counter() - start) * 1000, 2
            ),
            "checked_at": checked_at
        }

    except HTTPError as error:
        return {
            "url": url,
            "status": "unhealthy",
            "http_status": error.code,
            "error": "Application returned an HTTP error",
            "checked_at": checked_at
        }

    except (URLError, TimeoutError, OSError) as error:
        return {
            "url": url,
            "status": "unavailable",
            "error": str(error.reason) if isinstance(error, URLError)
                     else "Connection failed or timed out",
            "checked_at": checked_at
        }


def evaluate_metrics_rules(cpu_pct, mem_pct, disk_pct, health_status="healthy", simulate=None):
    """Rule-based incident evaluator using actual host telemetry.

    Threshold rules:
      - CPU: >= 90% Critical, >= 75% Warning
      - Memory: >= 90% Critical, >= 80% Warning
      - Disk: >= 90% Critical, >= 85% Warning
      - Health: Non-healthy status raises Critical incident
    """
    now = datetime.now(timezone.utc).isoformat()
    incidents = []

    # 1. CPU Rules
    effective_cpu = (
        95.0 if simulate == "cpu_critical"
        else (78.0 if simulate == "cpu_warning" else cpu_pct)
    )
    if effective_cpu is not None and effective_cpu >= 90.0:
        incidents.append({
            "id": "INC-CPU-900",
            "severity": "critical",
            "title": "[DEMO SIMULATION] High CPU Saturation Detected" if simulate else "High CPU Saturation Detected",
            "service": "Compute Subsystem",
            "status": "active",
            "detected": now,
            "resolved": None,
            "description": f"CPU utilization reached {effective_cpu:.1f}%, exceeding the 90.0% critical threshold.",
            "threshold": ">= 90.0%",
            "current_value": f"{effective_cpu:.1f}%",
            "source": "simulated" if simulate else "telemetry"
        })
    elif effective_cpu is not None and effective_cpu >= 75.0:
        incidents.append({
            "id": "INC-CPU-750",
            "severity": "warning",
            "title": "[DEMO SIMULATION] Elevated CPU Load Warning" if simulate else "Elevated CPU Load Warning",
            "service": "Compute Subsystem",
            "status": "active",
            "detected": now,
            "resolved": None,
            "description": f"CPU utilization reached {effective_cpu:.1f}%, exceeding the 75.0% warning threshold.",
            "threshold": ">= 75.0%",
            "current_value": f"{effective_cpu:.1f}%",
            "source": "simulated" if simulate else "telemetry"
        })

    # 2. Memory Rules
    effective_mem = (
        93.0 if simulate == "mem_critical"
        else (84.0 if simulate == "mem_warning" else mem_pct)
    )
    if effective_mem is not None and effective_mem >= 90.0:
        incidents.append({
            "id": "INC-MEM-900",
            "severity": "critical",
            "title": "[DEMO SIMULATION] Critical Memory Exhaustion Risk" if simulate else "Critical Memory Exhaustion Risk",
            "service": "Memory Subsystem",
            "status": "active",
            "detected": now,
            "resolved": None,
            "description": f"Virtual memory utilization reached {effective_mem:.1f}%, exceeding 90.0% critical threshold.",
            "threshold": ">= 90.0%",
            "current_value": f"{effective_mem:.1f}%",
            "source": "simulated" if simulate else "telemetry"
        })
    elif effective_mem is not None and effective_mem >= 80.0:
        incidents.append({
            "id": "INC-MEM-800",
            "severity": "warning",
            "title": "[DEMO SIMULATION] High Memory Usage Warning" if simulate else "High Memory Usage Warning",
            "service": "Memory Subsystem",
            "status": "active",
            "detected": now,
            "resolved": None,
            "description": f"Virtual memory utilization reached {effective_mem:.1f}%, exceeding 80.0% warning threshold.",
            "threshold": ">= 80.0%",
            "current_value": f"{effective_mem:.1f}%",
            "source": "simulated" if simulate else "telemetry"
        })

    # 3. Disk Storage Rules
    effective_disk = (
        92.0 if simulate == "disk_critical"
        else (86.0 if simulate == "disk_warning" else disk_pct)
    )
    if effective_disk is not None and effective_disk >= 90.0:
        incidents.append({
            "id": "INC-DSK-900",
            "severity": "critical",
            "title": "[DEMO SIMULATION] Critical Storage Capacity Alert" if simulate else "Critical Storage Capacity Alert",
            "service": "Storage Subsystem",
            "status": "active",
            "detected": now,
            "resolved": None,
            "description": f"Filesystem utilization reached {effective_disk:.1f}%, exceeding 90.0% capacity limit.",
            "threshold": ">= 90.0%",
            "current_value": f"{effective_disk:.1f}%",
            "source": "simulated" if simulate else "telemetry"
        })
    elif effective_disk is not None and effective_disk >= 85.0:
        incidents.append({
            "id": "INC-DSK-850",
            "severity": "warning",
            "title": "[DEMO SIMULATION] Low Storage Space Warning" if simulate else "Low Storage Space Warning",
            "service": "Storage Subsystem",
            "status": "active",
            "detected": now,
            "resolved": None,
            "description": f"Filesystem utilization reached {effective_disk:.1f}%, exceeding 85.0% threshold.",
            "threshold": ">= 85.0%",
            "current_value": f"{effective_disk:.1f}%",
            "source": "simulated" if simulate else "telemetry"
        })

    # 4. Service Health Rule
    if health_status and health_status != "healthy":
        incidents.append({
            "id": "INC-SVC-500",
            "severity": "critical",
            "title": "Application Health Probe Degradation",
            "service": "Flask Control Center",
            "status": "active",
            "detected": now,
            "resolved": None,
            "description": f"Internal health probe returned non-healthy state: {health_status}",
            "threshold": "Status == healthy",
            "current_value": str(health_status),
            "source": "health_service"
        })

    # 5. Baseline Operational Status
    if not incidents:
        cpu_val = f"{cpu_pct:.1f}%" if cpu_pct is not None else "N/A"
        mem_val = f"{mem_pct:.1f}%" if mem_pct is not None else "N/A"
        dsk_val = f"{disk_pct:.1f}%" if disk_pct is not None else "N/A"
        incidents.append({
            "id": "INC-BASE-001",
            "severity": "info",
            "title": "All Telemetry Thresholds Normal",
            "service": "JEMI Sentinel Engine",
            "status": "resolved",
            "detected": now,
            "resolved": now,
            "description": f"Host telemetry within normal operating limits (CPU: {cpu_val}, RAM: {mem_val}, Storage: {dsk_val}).",
            "threshold": "CPU < 75%, RAM < 80%, Disk < 85%",
            "current_value": f"Healthy (CPU: {cpu_val}, RAM: {mem_val}, Disk: {dsk_val})",
            "source": "telemetry"
        })

    return incidents

