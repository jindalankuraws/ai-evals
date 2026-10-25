"""Sends one prompt to every model at once and tags each stream event with its model id."""
import asyncio
from dataclasses import dataclass
from typing import AsyncIterator, Callable

from app.providers.base import ProviderAdapter, SharedParams, StreamEvent
from app.providers.registry import parse_composite


@dataclass
class TaggedEvent:
    """A provider stream event plus the model that produced it."""

    model_id: str
    event: StreamEvent


async def fan_out(
    adapter_for: Callable[[str], ProviderAdapter],
    model_ids: list[str],
    prompt: str,
    system_prompt: str,
    params: SharedParams,
) -> AsyncIterator[TaggedEvent]:
    """Run all models concurrently and yield their events as they arrive."""
    queue: asyncio.Queue = asyncio.Queue()
    running = len(model_ids)

    async def consume(model_id: str) -> None:
        try:
            adapter = adapter_for(model_id)
            # adapters speak provider dialects, so they need the bare model id
            _, bare_model = parse_composite(model_id)
            async for ev in adapter.stream_completion(bare_model, prompt, system_prompt, params):
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