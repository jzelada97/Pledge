---
description: Reportar que estás bloqueado por otro rol y seguir con un mock
argument-hint: <qué te bloquea>
---
El humano está bloqueado: "$ARGUMENTS".

1. Identifica de qué área es lo que falta (`harness/team.json`) y su dueño (rol y usuario de GitHub).
2. Busca si ya hay un issue abierto: `gh issue list --label bloqueado --state open`. Si existe uno igual, coméntalo en vez de crear otro.
3. Si no existe, créalo con la etiqueta `bloqueado`, asignado al dueño:
   `gh issue create --title "[BLOQUEO] <resumen>" --label bloqueado --assignee <usuario> --body "<cuerpo>"`
   El cuerpo tiene 4 apartados: **A quién espero**, **Qué necesito exactamente** (lo mínimo), **Qué hago mientras tanto** y **Urgencia** (me para del todo / puedo seguir con mock / solo afecta a la integración).
4. Propón y, con el OK del humano, crea un **mock dentro de tu carpeta** que cumpla `docs/INTERFACES.md`, marcado con un comentario `// MOCK: borrar cuando se cierre #<issue>`.
5. Devuelve la URL del issue y un mensaje corto para pegar en el chat del equipo.
