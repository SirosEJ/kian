# Dictation and keyboard: accessibility check (SFT-301)

What is built and tested by the software (automated): the chat input has a text label and a hint read out with it ("Press Enter to send, Shift+Enter for a new line"); the microphone button says "Start dictation" or "Stop dictation" and reports whether it is on; the Send button has a label and a tooltip; a status line announces "Listening", "Transcribing" and, when dictation ends, "Dictation ready. Edit it if needed, then press Enter to send."; on a computer the cursor goes back into the box when dictation ends, so Enter sends the text and does not press the microphone again; Enter, Shift+Enter, Ctrl+Enter and Cmd+Enter behave as described; Settings has a **Keyboard** card (Enter sends, or Enter adds a new line) that applies at once and is saved on that device.

What only a person can confirm. Run this once with a real screen reader and write the result in `docs/live-evidence.md` (section SFT-300/301): date, device, screen reader, pass or fail, and what you heard. Fix anything that fails as a bug.

| # | Device and tool | Do | You should hear or see |
| --- | --- | --- | --- |
| 1 | Computer, keyboard only (no mouse) | Tab to the chat box | "Type an instruction", then the hint about Enter |
| 2 | Same | Tab to the microphone button, press Space | "Stop dictation, pressed"; the status says "Listening" |
| 3 | Same | Speak, then press Space again | "Dictation ready…" announced; the cursor is back in the box; the text is there |
| 4 | Same | Press Enter | The message is sent (once), not a second recording |
| 5 | Same | Type two lines with Shift+Enter, then Enter | Two lines are kept, then sent |
| 6 | Computer with VoiceOver (Mac) or NVDA (Windows) | Repeat 1 to 5 | Every control is named; nothing is read twice; focus never disappears |
| 7 | Phone with TalkBack (Android) or VoiceOver (iPhone) | Open the chat box, tap the microphone, speak, tap stop | The microphone state is announced; "Dictation ready…" is announced; the keyboard does NOT pop up by itself |
| 8 | Phone | Settings, Keyboard, turn "Press Enter to send" off; type two lines with Enter, then tap Send | Enter adds a line; Send sends; the Send button's tooltip says Ctrl+Enter |
| 9 | Any | Turn the setting back on | Enter sends again without reloading the page |
| 10 | Any, 200% zoom or large text | Open Home and Settings | Nothing is cut off; the hint text does not appear on screen (it is for screen readers only) |

Known limits: the setting is saved per device (browser storage), not per account, because a phone and a computer need different keyboards; it is lost if the person clears the browser's site data.
