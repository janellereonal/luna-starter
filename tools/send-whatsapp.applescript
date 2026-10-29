-- luna's whatsapp helper: opens a chat in the WhatsApp Mac app and types a message.
-- usage: osascript tools/send-whatsapp.applescript "<contact name>" "<message>" [draft|send]
-- "draft" (default) leaves the message typed in the box for you to check; "send" presses enter.
on run argv
	set contactName to item 1 of argv
	set msg to item 2 of argv
	set mode to "draft"
	if (count of argv) > 2 then set mode to item 3 of argv
	set oldClip to ""
	try
		set oldClip to the clipboard as text
	end try
	tell application "WhatsApp" to activate
	delay 1.0
	tell application "System Events"
		-- search for the chat
		keystroke "f" using {command down}
		delay 0.5
		keystroke "a" using {command down}
		set the clipboard to contactName
		keystroke "v" using {command down}
		delay 1.5
		key code 125 -- down to the first result
		delay 0.3
		key code 36 -- open it
		delay 1.0
		-- type the message
		set the clipboard to msg
		keystroke "v" using {command down}
		delay 0.4
		if mode is "send" then key code 36
	end tell
	delay 0.3
	set the clipboard to oldClip
	if mode is "send" then
		return "sent to " & contactName
	else
		return "drafted in " & contactName & "'s chat (not sent)"
	end if
end run
