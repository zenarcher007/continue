from textwrap import dedent
from typing import Any, AsyncGenerator, Callable, Coroutine
from ..core.observation import Observation
from ..core.main import Step, ChatMessage
from ..core.sdk import ContinueSDK, Models
from pydantic import Field


async def iterate_by_line(generator: AsyncGenerator[str, None], get_content: Callable[[Any], str], should_cancel: Callable[[], bool]) -> AsyncGenerator[str, None]:
    """Convert an async generator of chunks into an async generator of lines."""
    unfinished_line = ""
    async for chunk in generator:
        if should_cancel():
            return

        chunk_content = get_content(chunk)
        chunk_lines = chunk_content.split("\n")
        chunk_lines[0] = unfinished_line + chunk_lines[0]
        if chunk_content.endswith("\n"):
            unfinished_line = ""
            chunk_lines.pop()  # because this will be an empty string
        else:
            unfinished_line = chunk_lines.pop()

        for line in chunk_lines:
            yield line

    if unfinished_line != "" and unfinished_line != "\n":
        yield unfinished_line


class DiffEditStep(Step):
    name = "DiffEditStep"
    user_input: str = Field(
        ...,
        description="The instructions for how the file is to be changed.",
    )
    filename: str = Field(
        ...,
        description="The name of the file to be changed.",
    )
    description = "Make scattered edits in a file by writing a diff patch."

    _prompt: str = dedent("""\
        ```
        {file_content}
        ```
        
        This is the requested edit: "{user_input}"

        You will make this edit by writing a diff patch for the file. Before each set of changes, you should output at least one prior line for context.

        ```diff""")

    async def describe(self, models: Models) -> Coroutine[str, None, None]:
        return "Running step: " + self.name

    async def run(self, sdk: ContinueSDK) -> Coroutine[Observation, None, None]:
        file_content = await sdk.ide.readFile(self.filename)
        messages = await sdk.get_chat_context()
        messages.append(ChatMessage(
            role="user",
            content=self._prompt.format(
                user_input=self.user_input, file_content=file_content),
        ))

        # This is one idea, but you might also just use the diff as a way to get the range, then use the normal step.
        file_lines = file_content.split("\n")
        current_range_start_line = None
        block_lines = []  # Tuples of (added: bool, line: str)

        # Tuples
        blocks = []
        async for line in iterate_by_line(sdk.models.default.stream_chat(messages), lambda m: m["content"], sdk.current_step_was_deleted):

            if line == "```diff":
                continue
            elif line == "```":
                break

            if current_range_start_line is not None:
                if line.startswith("+ "):
                    block_lines.append((True, line[2:]))
                elif line.startswith("- "):
                    block_lines.append((False, line[2:]))
                else:
                    # End of the diff range
                    # Apply edits
                    start_line_num = None
                    for i in range(len(file_lines)):
                        if file_lines[i].strip() == current_range_start_line.strip():
                            start_line_num = i
                            break

                    if start_line_num is not None:
                        new_lines = [current_range_start_line]
                        for line in block_lines:
                            if line[0]:
                                new_lines.append(line[1])
                            else:
                                

                    # Clear
                    current_range_start_line = None
                    add_lines = []
                    remove_lines = []
            elif not line.startswith("+ ") and not line.startswith("- "):
                current_range_start_line = line
