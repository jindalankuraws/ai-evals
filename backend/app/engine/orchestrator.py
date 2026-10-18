"""Run orchestration — fan one prompt out to N models concurrently.

Every model gets the same prompt and the same shared params; each model's
stream is consumed by its own task and tagged with the model id before being
merged into one event flow, which the route relays to the browser.
"""
import asyncio
from dataclasses import dataclass
from typing import AsyncIterator

from app.providers.base import ProviderAdapter, SharedParams, StreamEvent


@dataclass
class TaggedEvent:
    """A provider stream event plus the model that produced it."""

    model_id: str
    event: StreamEvent


async def fan_out(
    adapter: ProviderAdapter,
    model_ids: list[str],
    prompt: str,
    system_prompt: str,
    params: SharedParams,
) -> AsyncIterator[TaggedEvent]:
    """Run all models concurrently and yield their events as they arrive.

    Events interleave across models — whichever model produces a token first
    emits it first. If the consumer stops early (browser gone), the
    still-running tasks are cancelled.
    """
    queue: asyncio.Queue = asyncio.Queue()
    running = len(model_ids)

    async def consume(model_id: str) -> None:
        try:
            async for ev in adapter.stream_completion(model_id, prompt, system_prompt, params):
                await queue.put(TaggedEvent(model_id, ev))
        except Exception as exc:  # never let one model's crash kill the fan-out
            await queue.put(TaggedEvent(model_id, StreamEvent(kind="error", error=str(exc))))
        finally:
            await queue.put(None)  # sentinel: this model is finished

    tasks = [asyncio.create_task(consume(model_id)) for model_id in model_ids]
    try:
        while running > 0:
            item = await queue.get()
            if item is None:
                running -= 1
            else:
                yield item
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)