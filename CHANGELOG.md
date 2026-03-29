# Changelog

## [1.1.0] - 2026-03-29

### Changed
- `sprintId` ahora es OBLIGATORIO en `create_task` (antes era opcional)
- Se valida que el sprint existe y pertenece al proyecto
- `developer` se auto-asigna al miembro con menos carga si no se pasa (ya existía, pero ahora falla si el proyecto no tiene miembros)

## [1.0.1] - Previous release

### Initial tracked version
