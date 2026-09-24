from datetime import UTC, datetime

from fastapi import APIRouter

from models import Alert, RiskLevel
from services.simulator import simulator

router = APIRouter(prefix="/alerts", tags=["alerts"])

_acknowledged: set[str] = set()

_MESSAGES = {
    RiskLevel.WATCH: "Heavy rainfall / rising trend forecast — monitor conditions.",
    RiskLevel.ADVISORY: "River approaching warning level — review downstream preparedness.",
    RiskLevel.HIGH: "Rapid rise detected — shelter and downstream readiness should be reviewed.",
    RiskLevel.CRITICAL: "Danger threshold projected to be crossed — prioritize evacuation preparation.",
}


def _active_alerts() -> list[Alert]:
    alerts: list[Alert] = []
    now = datetime.now(UTC).isoformat()

    for reading in simulator.list_rivers():
        if reading.risk == RiskLevel.NORMAL:
            continue
        alert_id = f"river-{reading.river_id}"
        alerts.append(Alert(
            id=alert_id,
            target_id=reading.river_id,
            target_type="river",
            risk=reading.risk,
            message=_MESSAGES[reading.risk],
            created_at=now,
            acknowledged=alert_id in _acknowledged,
        ))

    for reading in simulator.list_dams():
        if reading.risk == RiskLevel.NORMAL:
            continue
        alert_id = f"dam-{reading.dam_id}"
        alerts.append(Alert(
            id=alert_id,
            target_id=reading.dam_id,
            target_type="dam",
            risk=reading.risk,
            message=_MESSAGES[reading.risk],
            created_at=now,
            acknowledged=alert_id in _acknowledged,
        ))

    severity_order = [RiskLevel.CRITICAL, RiskLevel.HIGH, RiskLevel.ADVISORY, RiskLevel.WATCH]
    alerts.sort(key=lambda a: severity_order.index(a.risk))
    return alerts


@router.get("", response_model=list[Alert])
def list_alerts():
    return _active_alerts()


@router.post("/{alert_id}/ack")
def acknowledge_alert(alert_id: str):
    _acknowledged.add(alert_id)
    return {"id": alert_id, "acknowledged": True}
