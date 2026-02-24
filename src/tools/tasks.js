import { getAll, getById, create, update, remove, getDb } from '../firebase.js';
import { config } from '../config.js';

const PATH = 'tasks';

function calculatePriority(bizPoints, devPoints) {
  if (!devPoints || devPoints === 0) return 0;
  return Math.round((bizPoints / devPoints) * 10) / 10;
}

const VALID_STATUSES = ['to-do', 'in-progress', 'to-validate', 'validated', 'done'];
const FIBONACCI = [1, 2, 3, 5, 8, 13];

export const taskTools = {
  list_tasks: {
    description: 'Lista tareas con filtros opcionales por proyecto, sprint, estado, desarrollador o texto de búsqueda. Las tareas se devuelven ordenadas por prioridad (mayor primero).',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Filtrar por ID de proyecto' },
        sprintId: { type: 'string', description: 'Filtrar por ID de sprint' },
        status: { type: 'string', enum: VALID_STATUSES, description: 'Filtrar por estado' },
        developer: { type: 'string', description: 'Filtrar por UID del desarrollador asignado' },
        searchText: { type: 'string', description: 'Buscar por texto en el título' },
      },
    },
    handler: async ({ projectId, sprintId, status, developer, searchText }) => {
      let tasks = await getAll(PATH);

      if (projectId) tasks = tasks.filter(t => t.projectId === projectId);
      if (sprintId) tasks = tasks.filter(t => t.sprintId === sprintId);
      if (status) tasks = tasks.filter(t => t.status === status);
      if (developer) tasks = tasks.filter(t => t.developer === developer || t.coDeveloper === developer);
      if (searchText) {
        const lower = searchText.toLowerCase();
        tasks = tasks.filter(t => t.title && t.title.toLowerCase().includes(lower));
      }

      return tasks.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    },
  },

  get_task: {
    description: 'Obtiene el detalle completo de una tarea por su ID, incluyendo User Story, puntos, criterios de aceptación e historial.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'ID de la tarea' },
      },
      required: ['taskId'],
    },
    handler: async ({ taskId }) => {
      const task = await getById(PATH, taskId);
      if (!task) return { error: `Tarea ${taskId} no encontrada` };
      return task;
    },
  },

  create_task: {
    description: 'Crea una nueva tarea con User Story, puntos de negocio/desarrollo, criterios de aceptación y asignación opcional. La prioridad se calcula automáticamente como bizPoints/devPoints.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'ID del proyecto al que pertenece' },
        title: { type: 'string', description: 'Título de la tarea (3-200 caracteres)' },
        userStory: {
          type: 'object',
          description: 'Historia de usuario con formato Como.../Quiero.../Para...',
          properties: {
            who: { type: 'string', description: 'Como... (quién es el actor, min 5 caracteres)' },
            what: { type: 'string', description: 'Quiero... (qué funcionalidad, min 5 caracteres)' },
            why: { type: 'string', description: 'Para... (qué beneficio, min 5 caracteres)' },
          },
          required: ['who', 'what', 'why'],
        },
        acceptanceCriteria: {
          type: 'array',
          items: { type: 'string' },
          description: 'Lista de criterios de aceptación (mínimo 1)',
        },
        bizPoints: { type: 'number', enum: FIBONACCI, description: 'Puntos de negocio (Fibonacci: 1,2,3,5,8,13). Valor de negocio de la tarea.' },
        devPoints: { type: 'number', enum: FIBONACCI, description: 'Puntos de desarrollo (Fibonacci: 1,2,3,5,8,13). Esfuerzo técnico.' },
        sprintId: { type: 'string', description: 'ID del sprint (opcional, se puede asignar después)' },
        developer: { type: 'string', description: 'UID del desarrollador asignado (opcional)' },
        coDeveloper: { type: 'string', description: 'UID del co-desarrollador (opcional)' },
        startDate: { type: 'string', description: 'Fecha de inicio (YYYY-MM-DD, opcional)' },
        endDate: { type: 'string', description: 'Fecha de fin (YYYY-MM-DD, opcional)' },
        status: { type: 'string', enum: VALID_STATUSES, description: 'Estado inicial. Default: to-do' },
        implementationPlan: {
          type: 'object',
          description: 'Plan de implementación para tareas complejas (opcional). Incluye enfoque técnico, pasos, cambios en modelo de datos, API, riesgos y fuera de alcance.',
          properties: {
            status: { type: 'string', enum: ['pending', 'in-progress', 'done'], description: 'Estado del plan. Default: pending' },
            approach: { type: 'string', description: 'Enfoque técnico general de la implementación' },
            steps: { type: 'array', items: { type: 'string' }, description: 'Pasos de implementación ordenados' },
            dataModelChanges: { type: 'string', description: 'Cambios necesarios en el modelo de datos' },
            apiChanges: { type: 'string', description: 'Cambios necesarios en la API' },
            risks: { type: 'string', description: 'Riesgos identificados' },
            outOfScope: { type: 'string', description: 'Elementos fuera del alcance de esta tarea' },
          },
        },
        attachments: {
          type: 'array',
          description: 'Archivos adjuntos (opcional). Cada adjunto necesita id, name, url, storagePath, uploadedAt, uploadedBy.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'ID único del adjunto' },
              name: { type: 'string', description: 'Nombre del archivo' },
              url: { type: 'string', description: 'URL pública de descarga' },
              storagePath: { type: 'string', description: 'Ruta en Firebase Storage' },
              uploadedAt: { type: 'number', description: 'Timestamp de subida' },
              uploadedBy: { type: 'string', description: 'UID del usuario que subió' },
            },
            required: ['id', 'name', 'url', 'storagePath', 'uploadedAt', 'uploadedBy'],
          },
        },
        userId: { type: 'string', description: 'UID del creador. Si no se pasa, usa el default.' },
        userName: { type: 'string', description: 'Nombre del creador.' },
      },
      required: ['projectId', 'title', 'userStory', 'acceptanceCriteria', 'bizPoints', 'devPoints'],
    },
    handler: async ({ projectId, title, userStory, acceptanceCriteria, bizPoints, devPoints, sprintId, developer, coDeveloper, startDate, endDate, status, implementationPlan, attachments, userId, userName }) => {
      const uid = userId || config.defaultUserId;
      const uname = userName || config.defaultUserName;

      const project = await getById('projects', projectId);
      if (!project) return { error: `Proyecto ${projectId} no encontrado` };

      if (!FIBONACCI.includes(devPoints)) {
        return { error: `devPoints debe ser Fibonacci: ${FIBONACCI.join(', ')}` };
      }

      if (!acceptanceCriteria || acceptanceCriteria.length === 0) {
        return { error: 'Se requiere al menos un criterio de aceptación' };
      }

      const now = Date.now();
      const priority = calculatePriority(bizPoints, devPoints);

      const taskData = {
        title,
        projectId,
        sprintId: sprintId || '',
        userStory,
        acceptanceCriteria: acceptanceCriteria.filter(c => c.trim().length > 0),
        bizPoints,
        devPoints,
        priority,
        developer: developer || '',
        coDeveloper: coDeveloper || '',
        startDate: startDate || '',
        endDate: endDate || '',
        status: status || 'to-do',
        implementationPlan: implementationPlan ? {
          status: implementationPlan.status || 'pending',
          approach: implementationPlan.approach || '',
          steps: implementationPlan.steps || [],
          dataModelChanges: implementationPlan.dataModelChanges || '',
          apiChanges: implementationPlan.apiChanges || '',
          risks: implementationPlan.risks || '',
          outOfScope: implementationPlan.outOfScope || '',
        } : null,
        attachments: attachments || [],
        createdAt: now,
        updatedAt: now,
        createdBy: uid || '',
        createdByName: uname || '',
        history: {},
      };

      const id = await create(PATH, taskData);

      // Add creation history entry
      const historyRef = getDb().ref(`${PATH}/${id}/history`).push();
      await historyRef.set({
        id: historyRef.key,
        timestamp: now,
        userId: uid || '',
        userName: uname || '',
        field: 'task',
        oldValue: null,
        newValue: title,
        action: 'create',
      });

      // Send notification to assigned developer
      if (developer && developer !== uid) {
        try {
          const notifRef = getDb().ref(`notifications/${developer}`).push();
          await notifRef.set({
            id: notifRef.key,
            userId: developer,
            title: 'Nueva tarea asignada',
            message: `Se te ha asignado la tarea "${title}" en el proyecto "${project.name}"`,
            type: 'info',
            read: false,
            date: now,
            link: `/projects/${projectId}`,
          });
        } catch { /* notification failure shouldn't block task creation */ }
      }

      return { id, message: `Tarea "${title}" creada con prioridad ${priority}`, task: { id, ...taskData } };
    },
  },

  update_task: {
    description: 'Actualiza campos de una tarea existente. Recalcula prioridad si se cambian los puntos. Registra el cambio en el historial.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'ID de la tarea' },
        title: { type: 'string', description: 'Nuevo título' },
        userStory: {
          type: 'object',
          properties: {
            who: { type: 'string' },
            what: { type: 'string' },
            why: { type: 'string' },
          },
        },
        acceptanceCriteria: { type: 'array', items: { type: 'string' } },
        bizPoints: { type: 'number', enum: FIBONACCI, description: 'Nuevos puntos de negocio (Fibonacci: 1,2,3,5,8,13)' },
        devPoints: { type: 'number', enum: FIBONACCI, description: 'Nuevos puntos de desarrollo (Fibonacci)' },
        sprintId: { type: 'string', description: 'Nuevo sprint ID (vacío para desasignar)' },
        developer: { type: 'string', description: 'Nuevo desarrollador UID' },
        coDeveloper: { type: 'string', description: 'Nuevo co-desarrollador UID' },
        startDate: { type: 'string' },
        endDate: { type: 'string' },
        status: { type: 'string', enum: VALID_STATUSES },
        implementationPlan: {
          type: 'object',
          description: 'Plan de implementación (reemplaza el existente)',
          properties: {
            status: { type: 'string', enum: ['pending', 'in-progress', 'done'] },
            approach: { type: 'string' },
            steps: { type: 'array', items: { type: 'string' } },
            dataModelChanges: { type: 'string' },
            apiChanges: { type: 'string' },
            risks: { type: 'string' },
            outOfScope: { type: 'string' },
          },
        },
        attachments: {
          type: 'array',
          description: 'Archivos adjuntos (reemplaza los existentes)',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              url: { type: 'string' },
              storagePath: { type: 'string' },
              uploadedAt: { type: 'number' },
              uploadedBy: { type: 'string' },
            },
          },
        },
        userId: { type: 'string', description: 'UID del usuario que realiza el cambio' },
        userName: { type: 'string', description: 'Nombre del usuario que realiza el cambio' },
      },
      required: ['taskId'],
    },
    handler: async ({ taskId, userId, userName, ...updates }) => {
      const task = await getById(PATH, taskId);
      if (!task) return { error: `Tarea ${taskId} no encontrada` };

      const uid = userId || config.defaultUserId;
      const uname = userName || config.defaultUserName;
      const now = Date.now();

      const clean = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined));
      if (Object.keys(clean).length === 0) return { error: 'No se proporcionaron campos para actualizar' };

      // Recalculate priority if points changed
      const biz = clean.bizPoints ?? task.bizPoints;
      const dev = clean.devPoints ?? task.devPoints;
      if (clean.bizPoints !== undefined || clean.devPoints !== undefined) {
        clean.priority = calculatePriority(biz, dev);
      }

      clean.updatedAt = now;
      await update(PATH, taskId, clean);

      // Add history entries for each changed field
      for (const [field, newValue] of Object.entries(clean)) {
        if (field === 'updatedAt' || field === 'priority') continue;
        const oldValue = task[field];
        if (JSON.stringify(oldValue) === JSON.stringify(newValue)) continue;

        const historyRef = getDb().ref(`${PATH}/${taskId}/history`).push();
        await historyRef.set({
          id: historyRef.key,
          timestamp: now,
          userId: uid || '',
          userName: uname || '',
          field,
          oldValue: oldValue ?? null,
          newValue,
          action: 'update',
        });
      }

      // Notify on status change
      if (clean.status && clean.status !== task.status && task.developer && task.developer !== uid) {
        try {
          const project = await getById('projects', task.projectId);
          const notifRef = getDb().ref(`notifications/${task.developer}`).push();
          await notifRef.set({
            id: notifRef.key,
            userId: task.developer,
            title: 'Estado de tarea actualizado',
            message: `La tarea "${task.title}" cambió de "${task.status}" a "${clean.status}" en "${project?.name || ''}"`,
            type: 'info',
            read: false,
            date: now,
            link: `/projects/${task.projectId}`,
          });
        } catch { /* */ }
      }

      // Notify on reassignment
      if (clean.developer && clean.developer !== task.developer && clean.developer !== uid) {
        try {
          const project = await getById('projects', task.projectId);
          const notifRef = getDb().ref(`notifications/${clean.developer}`).push();
          await notifRef.set({
            id: notifRef.key,
            userId: clean.developer,
            title: 'Tarea reasignada',
            message: `Se te ha asignado la tarea "${task.title}" en "${project?.name || ''}"`,
            type: 'info',
            read: false,
            date: now,
            link: `/projects/${task.projectId}`,
          });
        } catch { /* */ }
      }

      return { message: `Tarea "${task.title}" actualizada`, updated: clean };
    },
  },

  delete_task: {
    description: 'Elimina una tarea y todos sus comentarios asociados.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'ID de la tarea a eliminar' },
      },
      required: ['taskId'],
    },
    handler: async ({ taskId }) => {
      const task = await getById(PATH, taskId);
      if (!task) return { error: `Tarea ${taskId} no encontrada` };

      // Delete associated comments
      try {
        await getDb().ref(`comments/${taskId}`).remove();
      } catch { /* */ }

      await remove(PATH, taskId);

      // Notify assigned developer
      if (task.developer) {
        try {
          const project = await getById('projects', task.projectId);
          const notifRef = getDb().ref(`notifications/${task.developer}`).push();
          await notifRef.set({
            id: notifRef.key,
            userId: task.developer,
            title: 'Tarea eliminada',
            message: `La tarea "${task.title}" fue eliminada del proyecto "${project?.name || ''}"`,
            type: 'warning',
            read: false,
            date: Date.now(),
          });
        } catch { /* */ }
      }

      return { message: `Tarea "${task.title}" eliminada` };
    },
  },

  change_task_status: {
    description: 'Cambia el estado de una tarea. Estados válidos: to-do, in-progress, to-validate, validated, done. Registra el cambio en el historial y notifica al desarrollador.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'ID de la tarea' },
        newStatus: { type: 'string', enum: VALID_STATUSES, description: 'Nuevo estado' },
        userId: { type: 'string', description: 'UID del usuario que cambia el estado' },
        userName: { type: 'string', description: 'Nombre del usuario' },
      },
      required: ['taskId', 'newStatus'],
    },
    handler: async ({ taskId, newStatus, userId, userName }) => {
      const task = await getById(PATH, taskId);
      if (!task) return { error: `Tarea ${taskId} no encontrada` };

      if (task.status === newStatus) return { message: `La tarea ya está en estado "${newStatus}"` };

      const uid = userId || config.defaultUserId;
      const uname = userName || config.defaultUserName;
      const now = Date.now();

      await update(PATH, taskId, { status: newStatus, updatedAt: now });

      // History
      const historyRef = getDb().ref(`${PATH}/${taskId}/history`).push();
      await historyRef.set({
        id: historyRef.key,
        timestamp: now,
        userId: uid || '',
        userName: uname || '',
        field: 'status',
        oldValue: task.status,
        newValue: newStatus,
        action: 'update',
      });

      return { message: `Tarea "${task.title}": ${task.status} → ${newStatus}` };
    },
  },

  assign_task: {
    description: 'Asigna o reasigna un desarrollador y/o co-desarrollador a una tarea.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'ID de la tarea' },
        developer: { type: 'string', description: 'UID del desarrollador principal (vacío para desasignar)' },
        coDeveloper: { type: 'string', description: 'UID del co-desarrollador (vacío para desasignar)' },
        userId: { type: 'string', description: 'UID del usuario que asigna' },
        userName: { type: 'string', description: 'Nombre del usuario que asigna' },
      },
      required: ['taskId'],
    },
    handler: async ({ taskId, developer, coDeveloper, userId, userName }) => {
      const task = await getById(PATH, taskId);
      if (!task) return { error: `Tarea ${taskId} no encontrada` };

      const uid = userId || config.defaultUserId;
      const uname = userName || config.defaultUserName;
      const now = Date.now();
      const updates = { updatedAt: now };

      if (developer !== undefined) updates.developer = developer;
      if (coDeveloper !== undefined) updates.coDeveloper = coDeveloper;

      await update(PATH, taskId, updates);

      // History & notifications for developer change
      if (developer !== undefined && developer !== task.developer) {
        const historyRef = getDb().ref(`${PATH}/${taskId}/history`).push();
        await historyRef.set({
          id: historyRef.key,
          timestamp: now,
          userId: uid || '',
          userName: uname || '',
          field: 'developer',
          oldValue: task.developer || null,
          newValue: developer,
          action: 'update',
        });

        if (developer && developer !== uid) {
          try {
            const project = await getById('projects', task.projectId);
            const notifRef = getDb().ref(`notifications/${developer}`).push();
            await notifRef.set({
              id: notifRef.key,
              userId: developer,
              title: 'Tarea asignada',
              message: `Se te ha asignado la tarea "${task.title}" en "${project?.name || ''}"`,
              type: 'info',
              read: false,
              date: now,
              link: `/projects/${task.projectId}`,
            });
          } catch { /* */ }
        }
      }

      return { message: `Asignación de "${task.title}" actualizada`, updated: updates };
    },
  },

  move_tasks_to_sprint: {
    description: 'Mueve múltiples tareas a un sprint específico. Útil para planificación de sprints.',
    inputSchema: {
      type: 'object',
      properties: {
        taskIds: { type: 'array', items: { type: 'string' }, description: 'Lista de IDs de tareas a mover' },
        sprintId: { type: 'string', description: 'ID del sprint destino (vacío para desasignar del sprint)' },
      },
      required: ['taskIds', 'sprintId'],
    },
    handler: async ({ taskIds, sprintId }) => {
      if (sprintId) {
        const sprint = await getById('sprints', sprintId);
        if (!sprint) return { error: `Sprint ${sprintId} no encontrado` };
      }

      let moved = 0;
      const errors = [];
      for (const taskId of taskIds) {
        const task = await getById(PATH, taskId);
        if (!task) {
          errors.push(`Tarea ${taskId} no encontrada`);
          continue;
        }
        await update(PATH, taskId, { sprintId, updatedAt: Date.now() });
        moved++;
      }

      return {
        message: `${moved} tareas movidas al sprint${sprintId ? '' : ' (desasignadas)'}`,
        moved,
        errors: errors.length > 0 ? errors : undefined,
      };
    },
  },
};
