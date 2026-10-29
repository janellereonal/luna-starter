-- luna's mac control kit. usage: osascript tools/mac.applescript <action> [args...]
--   open "<App Name>"                  bring an app to the front (opens it if needed)
--   type "<text>"                      type text into whatever is focused (via clipboard, so emoji work)
--   key "<key>" ["cmd,shift,option,control"]   press a key: enter, tab, escape, up, down, left, right, delete, space, or a letter
--   enter                              press enter / return
--   menu "<App>" "<Menu>" "<Item>"     click a menu bar item, e.g. menu "WhatsApp" "File" "New Chat"
--   front                              name of the frontmost app
--   wait "<seconds>"                   pause
on run argv
	set action to item 1 of argv
	if action is "open" then
		tell application (item 2 of argv) to activate
		delay 0.8
		return "opened " & (item 2 of argv)
	else if action is "type" then
		set oldClip to ""
		try
			set oldClip to the clipboard as text
		end try
		set the clipboard to (item 2 of argv)
		tell application "System Events" to keystroke "v" using {command down}
		delay 0.3
		set the clipboard to oldClip
		return "typed"
	else if action is "enter" then
		tell application "System Events" to key code 36
		return "pressed enter"
	else if action is "key" then
		set k to item 2 of argv
		set mods to {}
		if (count of argv) > 2 then
			set m to item 3 of argv
			if m contains "cmd" then set end of mods to command down
			if m contains "shift" then set end of mods to shift down
			if m contains "option" then set end of mods to option down
			if m contains "control" then set end of mods to control down
		end if
		set codes to {{"enter", 36}, {"return", 36}, {"tab", 48}, {"escape", 53}, {"esc", 53}, {"delete", 51}, {"space", 49}, {"up", 126}, {"down", 125}, {"left", 123}, {"right", 124}}
		repeat with c in codes
			if (item 1 of c) is k then
				tell application "System Events" to key code (item 2 of c) using mods
				return "pressed " & k
			end if
		end repeat
		tell application "System Events" to keystroke k using mods
		return "pressed " & k
	else if action is "menu" then
		tell application (item 2 of argv) to activate
		delay 0.4
		tell application "System Events" to tell process (item 2 of argv)
			click menu item (item 4 of argv) of menu (item 3 of argv) of menu bar 1
		end tell
		return "clicked " & (item 3 of argv) & " > " & (item 4 of argv)
	else if action is "front" then
		tell application "System Events" to set f to name of first application process whose frontmost is true
		return f
	else if action is "wait" then
		delay ((item 2 of argv) as number)
		return "waited"
	end if
	return "unknown action: " & action
end run
