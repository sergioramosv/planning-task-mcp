#!/usr/bin/env node

import { existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { homedir } from 'os';
import { createInterface } from 'readline';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');

const CONFIG_DIR = join(homedir(), '.planning-mcp');
const ENV_PATH = join(CONFIG_DIR, '.env');
const SA_KEY_PATH = join(CONFIG_DIR, 'serviceAccountKey.json');

function ask(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}

function printBanner() {
  console.log('');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║       Planning MCP - Setup Wizard        ║');
  console.log('  ╚══════════════════════════════════════════╝');
  console.log('');
  console.log('  Este script configura todo lo necesario para');
  console.log('  que el servidor MCP funcione con tu Firebase.');
  console.log('');
  console.log(`  Config dir: ${CONFIG_DIR}`);
  console.log('');
}

function printStep(num, total, title) {
  console.log(`\n  ── Paso ${num}/${total}: ${title} ──\n`);
}

function ensureDependencies() {
  const nodeModulesPath = join(PROJECT_ROOT, 'node_modules');
  const sdkPath = join(nodeModulesPath, '@modelcontextprotocol', 'sdk');
  const firebasePath = join(nodeModulesPath, 'firebase-admin');

  if (existsSync(sdkPath) && existsSync(firebasePath)) {
    console.log('  ✓ Dependencias ya instaladas\n');
    return;
  }

  console.log('  Instalando dependencias (npm install)...');
  try {
    execSync('npm install', { cwd: PROJECT_ROOT, stdio: 'pipe' });
    console.log('  ✓ Dependencias instaladas correctamente\n');
  } catch (err) {
    console.error(`  ✗ ERROR al instalar dependencias: ${err.message}`);
    console.error('  Intenta manualmente: cd ' + PROJECT_ROOT + ' && npm install');
    process.exit(1);
  }
}

async function setup() {
  printBanner();

  // ═══ STEP 0: Ensure node_modules ═══
  printStep(0, 6, 'Verificar dependencias de Node');
  ensureDependencies();

  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
    console.log(`  ✓ Directorio creado: ${CONFIG_DIR}\n`);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const currentEnv = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf-8') : '';

  try {
    // ═══ STEP 1: Service Account Key ═══
    printStep(1, 6, 'Service Account Key de Firebase');
    console.log('  Descárgalo desde:');
    console.log('  Firebase Console → Configuración del proyecto');
    console.log('  → Cuentas de servicio → Generar nueva clave privada\n');

    if (existsSync(SA_KEY_PATH)) {
      console.log(`  ⚡ Ya existe: ${SA_KEY_PATH}`);
      const overwrite = await ask(rl, '  ¿Sobreescribir? (s/N): ');
      if (overwrite.toLowerCase() === 's') {
        await promptServiceAccountKey(rl);
      } else {
        console.log('  → Se mantiene el existente.');
      }
    } else {
      await promptServiceAccountKey(rl);
    }

    // Try to auto-detect databaseURL from service account
    let autoDbUrl = '';
    if (existsSync(SA_KEY_PATH)) {
      try {
        const sa = JSON.parse(readFileSync(SA_KEY_PATH, 'utf-8'));
        if (sa.project_id) {
          // Common RTDB URL patterns
          autoDbUrl = `https://${sa.project_id}-default-rtdb.europe-west1.firebasedatabase.app`;
        }
      } catch { /* */ }
    }

    // ═══ STEP 2: Database URL ═══
    printStep(2, 6, 'URL de Realtime Database');
    console.log('  Encuéntrala en:');
    console.log('  Firebase Console → Realtime Database → URL en la parte superior\n');

    const currentDbUrl = currentEnv.match(/FIREBASE_DATABASE_URL=(.+)/)?.[1] || '';
    const suggestedUrl = currentDbUrl || autoDbUrl;

    let dbUrl;
    if (suggestedUrl) {
      console.log(`  Detectada: ${suggestedUrl}`);
      dbUrl = await ask(rl, '  Pulsa Enter para usar esta, o escribe otra:\n  > ');
    } else {
      dbUrl = await ask(rl, '  URL:\n  > ');
    }

    const finalDbUrl = dbUrl.trim() || suggestedUrl;
    if (!finalDbUrl) {
      console.error('\n  ✗ ERROR: Se requiere la URL de la base de datos.');
      process.exit(1);
    }
    console.log(`  ✓ Database URL: ${finalDbUrl}`);

    // ═══ STEP 3: User ID ═══
    printStep(3, 6, 'Tu UID de Firebase Auth');
    console.log('  Encuéntralo en:');
    console.log('  Firebase Console → Authentication → Users → columna "UID"\n');

    const currentUserId = currentEnv.match(/DEFAULT_USER_ID=(.+)/)?.[1] || '';
    const userId = await ask(
      rl,
      `  UID${currentUserId ? ` (actual: ${currentUserId}, Enter para mantener)` : ''}:\n  > `
    );
    const finalUserId = userId.trim() || currentUserId;
    if (finalUserId) console.log(`  ✓ User ID: ${finalUserId}`);

    // ═══ STEP 4: User Name ═══
    printStep(4, 6, 'Tu nombre de usuario');

    const currentUserName = currentEnv.match(/DEFAULT_USER_NAME=(.+)/)?.[1] || '';
    const userName = await ask(
      rl,
      `  Nombre${currentUserName ? ` (actual: ${currentUserName}, Enter para mantener)` : ''}:\n  > `
    );
    const finalUserName = userName.trim() || currentUserName;
    if (finalUserName) console.log(`  ✓ User Name: ${finalUserName}`);

    // Write .env
    const envContent = [
      `FIREBASE_DATABASE_URL=${finalDbUrl}`,
      `DEFAULT_USER_ID=${finalUserId}`,
      `DEFAULT_USER_NAME=${finalUserName}`,
    ].join('\n') + '\n';

    writeFileSync(ENV_PATH, envContent);

    // ═══ STEP 5: Configure MCP in clients ═══
    printStep(5, 6, 'Registrar MCP en clientes');

    const indexPath = join(PROJECT_ROOT, 'src', 'index.js').replace(/\\/g, '/');
    const mcpServerEntry = {
      "command": "node",
      "args": [indexPath]
    };

    // Define all known MCP client config locations
    const isWin = process.platform === 'win32';
    const appData = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');

    const clients = [
      {
        name: 'Claude Code',
        path: join(homedir(), '.mcp.json'),
        format: 'mcpServers',  // { mcpServers: { "name": { command, args } } }
      },
      {
        name: 'Claude Desktop',
        path: isWin
          ? join(appData, 'Claude', 'claude_desktop_config.json')
          : join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
        format: 'mcpServers',
      },
      {
        name: 'Cursor',
        path: join(homedir(), '.cursor', 'mcp.json'),
        format: 'mcpServers',
      },
      {
        name: 'Windsurf',
        path: join(homedir(), '.codeium', 'windsurf', 'mcp_config.json'),
        format: 'mcpServers',
      },
      {
        name: 'VS Code (Copilot)',
        path: join(homedir(), '.vscode', 'mcp.json'),
        format: 'servers',  // { servers: { "name": { command, args } } }
      },
    ];

    console.log('  Clientes MCP detectados:\n');

    const configuredClients = [];
    for (const client of clients) {
      const exists = existsSync(client.path);
      const dirExists = existsSync(dirname(client.path));
      const marker = exists ? '(config existente)' : dirExists ? '(directorio existe)' : '(no encontrado)';
      console.log(`  ${exists || dirExists ? '●' : '○'} ${client.name} ${marker}`);
      console.log(`    ${client.path}`);
    }

    console.log('');
    const configureAll = await ask(
      rl,
      '  ¿Registrar planning-mcp en todos los clientes encontrados? (S/n): '
    );

    if (configureAll.toLowerCase() !== 'n') {
      for (const client of clients) {
        const dirPath = dirname(client.path);
        if (!existsSync(dirPath)) {
          // Only create dir if the client's parent dir is known to exist
          // (avoid creating dirs for uninstalled apps)
          const parentExists = existsSync(dirname(dirPath));
          if (!parentExists) {
            console.log(`  ⊘ ${client.name} - no instalado, omitido`);
            continue;
          }
          mkdirSync(dirPath, { recursive: true });
        }

        let existing = {};
        if (existsSync(client.path)) {
          try {
            existing = JSON.parse(readFileSync(client.path, 'utf-8'));
          } catch { /* */ }
        }

        const key = client.format; // 'mcpServers' or 'servers'
        const merged = {
          ...existing,
          [key]: {
            ...(existing[key] || {}),
            'planning-mcp': mcpServerEntry,
          },
        };

        writeFileSync(client.path, JSON.stringify(merged, null, 2) + '\n');
        console.log(`  ✓ ${client.name} configurado`);
        configuredClients.push(client.name);
      }
    } else {
      console.log('\n  Para configurar manualmente, añade esto a tu config MCP:');
      console.log(JSON.stringify({ mcpServers: { 'planning-mcp': mcpServerEntry } }, null, 2));
    }

    // ═══ STEP 6: VERIFICATION ═══
    printStep(6, 6, 'Verificación completa');

    const nodeModulesOk = existsSync(join(PROJECT_ROOT, 'node_modules', '@modelcontextprotocol', 'sdk'));
    const saKeyOk = existsSync(SA_KEY_PATH);
    const envOk = existsSync(ENV_PATH);
    const dbUrlOk = Boolean(finalDbUrl);
    const userIdOk = Boolean(finalUserId);
    const userNameOk = Boolean(finalUserName);

    // Validate serviceAccountKey structure
    let saKeyValid = false;
    if (saKeyOk) {
      try {
        const sa = JSON.parse(readFileSync(SA_KEY_PATH, 'utf-8'));
        saKeyValid = sa.type === 'service_account' && Boolean(sa.private_key) && Boolean(sa.project_id);
      } catch { /* */ }
    }

    console.log('  ╔══════════════════════════════════════════╗');
    console.log('  ║            Setup Completado               ║');
    console.log('  ╚══════════════════════════════════════════╝\n');
    console.log(`  node_modules            ${nodeModulesOk ? '✓' : '✗'}  ${nodeModulesOk ? 'SDK + Firebase instalados' : 'FALTAN dependencias'}`);
    console.log(`  serviceAccountKey.json  ${saKeyValid ? '✓' : saKeyOk ? '⚠ estructura inválida' : '✗'}`);
    console.log(`  .env                    ${envOk ? '✓' : '✗'}`);
    console.log(`  Database URL            ${dbUrlOk ? '✓' : '✗'}  ${finalDbUrl || '(vacío)'}`);
    console.log(`  User ID                 ${userIdOk ? '✓' : '⚠'}  ${finalUserId || '(no configurado)'}`);
    console.log(`  User Name               ${userNameOk ? '✓' : '⚠'}  ${finalUserName || '(no configurado)'}`);
    if (configuredClients.length > 0) {
      console.log(`  Clientes MCP            ✓  ${configuredClients.join(', ')}`);
    }

    // Check for critical failures
    const critical = [];
    if (!nodeModulesOk) critical.push('npm install');
    if (!saKeyValid) critical.push('serviceAccountKey.json');
    if (!dbUrlOk) critical.push('FIREBASE_DATABASE_URL');

    if (critical.length > 0) {
      console.log(`\n  ✗ ERRORES CRITICOS: Faltan ${critical.join(', ')}`);
      console.log('  El servidor NO podrá arrancar hasta que se resuelvan.\n');
      process.exit(1);
    }

    // Test connection
    console.log('\n  Probando conexión a Firebase...');
    try {
      const { getDb } = await import('./firebase.js');
      const db = getDb();
      const snap = await db.ref('users').limitToFirst(1).once('value');
      if (snap.exists()) {
        console.log('  ✓ Conexión exitosa. Firebase responde correctamente.\n');
      } else {
        console.log('  ⚠ Conexión OK pero no hay datos en /users. ¿La base de datos tiene datos?\n');
      }
    } catch (err) {
      console.log(`  ✗ Error de conexión: ${err.message}`);
      console.log('  Verifica que la URL y el serviceAccountKey sean correctos.\n');
    }

    // Test server can actually start (quick smoke test)
    console.log('  Verificando que el servidor MCP arranca...');
    try {
      const indexPath = join(PROJECT_ROOT, 'src', 'index.js');
      // Import the config validation only (don't start the full server)
      const { validateConfig } = await import('./config.js');
      const configErrors = validateConfig();
      if (configErrors.length === 0) {
        console.log('  ✓ Configuración válida. El servidor está listo para arrancar.\n');
      } else {
        console.log('  ✗ Errores de configuración:');
        configErrors.forEach(e => console.log(`    - ${e}`));
        console.log('');
      }
    } catch (err) {
      console.log(`  ✗ Error al verificar servidor: ${err.message}\n`);
    }

    console.log('  ─────────────────────────────────────────');
    console.log('  Abre cualquier cliente MCP y pídele:');
    console.log('    "Lista mis proyectos"');
    console.log('    "Crea un sprint para el proyecto X"');
    console.log('    "Planifica este documento: [pega tu texto]"');
    console.log('  ─────────────────────────────────────────\n');

  } finally {
    rl.close();
  }
}

async function promptServiceAccountKey(rl) {
  const saPath = await ask(
    rl,
    '  Ruta al archivo serviceAccountKey.json (arrastra el archivo aquí):\n  > '
  );

  const trimmed = saPath.trim().replace(/^["']|["']$/g, '');
  if (!trimmed) {
    console.error('  ✗ ERROR: Se requiere el archivo serviceAccountKey.json');
    process.exit(1);
  }

  if (!existsSync(trimmed)) {
    console.error(`  ✗ ERROR: No se encontró: ${trimmed}`);
    process.exit(1);
  }

  // Validate JSON and check it's a service account
  try {
    const parsed = JSON.parse(readFileSync(trimmed, 'utf-8'));
    if (parsed.type !== 'service_account') {
      console.error('  ✗ ERROR: El archivo no es un Service Account Key válido.');
      process.exit(1);
    }
    console.log(`  ✓ Service Account Key válida (proyecto: ${parsed.project_id})`);
  } catch {
    console.error('  ✗ ERROR: El archivo no es JSON válido.');
    process.exit(1);
  }

  copyFileSync(trimmed, SA_KEY_PATH);
  console.log(`  ✓ Copiado a ${CONFIG_DIR}`);
}

setup().catch(err => {
  console.error('Error en setup:', err.message);
  process.exit(1);
});
