#!/bin/zsh
# read the latest whatsapp messages with a contact from the whatsapp mac app's local database (read only)
# usage: tools/wa-recent.sh "<contact name>" [count]
DB="$HOME/Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite"
NAME="${1//\'/\'\'}"; N="${2//[^0-9]/}"; N="${N:-12}"
[ -f "$DB" ] || { echo '{"error":"whatsapp database not found or no permission"}'; exit 1; }
sqlite3 -readonly -json "$DB" "SELECT m.Z_PK AS id, m.ZISFROMME AS me, COALESCE(m.ZTEXT,'[media]') AS text, datetime(m.ZMESSAGEDATE + 978307200, 'unixepoch', 'localtime') AS t, c.ZPARTNERNAME AS chat FROM ZWAMESSAGE m JOIN ZWACHATSESSION c ON m.ZCHATSESSION = c.Z_PK WHERE c.ZPARTNERNAME LIKE '%${NAME}%' ORDER BY m.ZMESSAGEDATE DESC LIMIT ${N};" 2>&1
