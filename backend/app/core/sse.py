"""Formatting helpers for streamed events.

Every streaming endpoint sends its messages through these helpers so the
frontend only ever has to parse one wire format.
"""
import json


def event(name: str, payload: dict) -> str:
    """Format one streamed message: an event line, a data line, a blank line."""
    return f"event: {name}\ndata: {json.dumps(payload)}\n\n"
