
import time
from datetime import datetime, timezone
from urllib.request import urlopen
from urllib.error import URLError, HTTPError


def check_application(url, timeout=3):
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
