<!-- Título del PR = mensaje del squash: tipo(scope): descripción  ·  ej. feat(escrow): añadir approve_release -->

## Qué cambia
<!-- 1–3 frases. Qué puede hacer ahora el producto que antes no. -->

## Issue
Closes #

## Cómo probarlo
<!-- Comando o pasos exactos. Ej: cargo test -p escrow approve_release -->

## Checklist
- [ ] Solo toca mi área (o lleva la etiqueta `cross-area` aprobada por el dueño)
- [ ] Tests y typecheck de mi área en verde en local
- [ ] Si cambia `docs/INTERFACES.md`: issue "Cambio de interfaz" enlazado y lock `interfaces` tomado
- [ ] Si toca el contrato: aviso a P2 para regenerar bindings y redesplegar
- [ ] Sin secretos ni direcciones escritas a mano (se leen de `deployments/testnet.json`)
- [ ] < 300 líneas, o explico por qué no se puede partir
