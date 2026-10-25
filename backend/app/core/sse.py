"""Formatting helpers for streamed events."""
import json


def event(name: str, payload: dict) -> str:
    """Format one streamed message: an event line, a data line, a blank line."""
    return f"event: {name}\ndata: {json.dumps(payload)}\n\n"
