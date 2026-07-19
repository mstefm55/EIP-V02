#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const requiredFiles = [
  path.join('services', 'api', 'src', 'core', 'core_process_engine.js'),
  path.join('services', 'api', 'src', 'routes', 'process', 'core_process.js'),
  path.join('db', 'migrations', 'v2_0011_inline_macro_cleanup.sql'),
  path.join('db', 'migrations', 'v2_0012_effect_document_governance.sql'),
  path.join('db', 'migrations', 'v2_0013_process_workbench_surface_foundation.sql'),
  path.join('db', 'migrations', 'v2_0014_workbench_ui_generic_primitive_composition.sql'),
  path.join('db', 'migrations', 'v2_0015_workbench_surface_layout_metadata_composition.sql'),
  path.join('db', 'migrations', 'v2_0016_definition_studio_primitive_decomposition.sql'),
  path.join('db', 'migrations', 'v2_0017_owner_admin_shell_theme_tokens.sql'),
  path.join('db', 'migrations', 'v2_0018_owner_admin_shell_profile_layer.sql'),
  path.join('db', 'migrations', 'v2_0019_owner_admin_shell_profile_lifecycle.sql'),
  path.join('apps', 'workbench-ui', 'src', 'App.jsx'),
  path.join('apps', 'workbench-ui', 'src', 'engine', 'renderer.jsx'),
  path.join('apps', 'workbench-ui', 'src', 'engine', 'registry.jsx'),
  path.join('apps', 'workbench-ui', 'src', 'engine', 'themeGovernance.js'),
  path.join('apps', 'workbench-ui', 'src', 'components', 'primitives', 'ContractDetailEditor.jsx'),
  path.join('apps', 'workbench-ui', 'src', 'components', 'primitives', 'SplitLayout.jsx'),
  path.join('apps', 'workbench-ui', 'src', 'components', 'shell', 'LoginPanel.jsx'),
  path.join('apps', 'workbench-ui', 'src', 'components', 'shell', 'OwnerAdminShell.jsx'),
  path.join('apps', 'workbench-ui', 'src', 'engine', 'surfaceCache.js'),
  path.join('apps', 'workbench-ui', 'src', 'engine', 'surfacePayload.js'),
  path.join('apps', 'workbench-ui', 'src', 'hooks', 'useSurfaceLoader.js'),
  path.join('apps', 'workbench-ui', 'src', 'hooks', 'useSurfaceCatalog.js'),
  path.join('apps', 'workbench-ui', 'playwright.config.mjs'),
  path.join('apps', 'workbench-ui', 'tests', 'workbench.authenticated.smoke.spec.mjs'),
  path.join('services', 'api', 'src', 'routes', 'ui_surface.js'),
  path.join('docs', 'architecture', 'OWNER_ADMIN_SHELL_PROFILE_LIFECYCLE.md'),
  path.join('docs', 'architecture', 'TASK_EFFECT_MODEL.md'),
  path.join('docs', 'dev', 'DEVELOPER_MANUAL.md'),
];

const failures = [];

for (const relPath of requiredFiles) {
  if (!fs.existsSync(path.join(root, relPath))) {
    failures.push(`${relPath}: missing required governance artifact`);
  }
}

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

if (failures.length === 0) {
  const engine = read(path.join('services', 'api', 'src', 'core', 'core_process_engine.js'));
  const processRoute = read(path.join('services', 'api', 'src', 'routes', 'process', 'core_process.js'));
  const migration0012 = read(path.join('db', 'migrations', 'v2_0012_effect_document_governance.sql'));
  const migration0013 = read(path.join('db', 'migrations', 'v2_0013_process_workbench_surface_foundation.sql'));
  const migration0014 = read(path.join('db', 'migrations', 'v2_0014_workbench_ui_generic_primitive_composition.sql'));
  const migration0015 = read(path.join('db', 'migrations', 'v2_0015_workbench_surface_layout_metadata_composition.sql'));
  const migration0016 = read(path.join('db', 'migrations', 'v2_0016_definition_studio_primitive_decomposition.sql'));
  const migration0017 = read(path.join('db', 'migrations', 'v2_0017_owner_admin_shell_theme_tokens.sql'));
  const migration0018 = read(path.join('db', 'migrations', 'v2_0018_owner_admin_shell_profile_layer.sql'));
  const migration0019 = read(path.join('db', 'migrations', 'v2_0019_owner_admin_shell_profile_lifecycle.sql'));
  const workbenchApp = read(path.join('apps', 'workbench-ui', 'src', 'App.jsx'));
  const workbenchRegistry = read(path.join('apps', 'workbench-ui', 'src', 'engine', 'registry.jsx'));
  const workbenchTheme = read(path.join('apps', 'workbench-ui', 'src', 'engine', 'themeGovernance.js'));
  const ownerAdminShell = read(path.join('apps', 'workbench-ui', 'src', 'components', 'shell', 'OwnerAdminShell.jsx'));
  const workbenchRenderer = read(path.join('apps', 'workbench-ui', 'src', 'engine', 'renderer.jsx'));
  const surfaceLoader = read(path.join('apps', 'workbench-ui', 'src', 'hooks', 'useSurfaceLoader.js'));
  const surfaceCatalog = read(path.join('apps', 'workbench-ui', 'src', 'hooks', 'useSurfaceCatalog.js'));
  const surfaceCache = read(path.join('apps', 'workbench-ui', 'src', 'engine', 'surfaceCache.js'));
  const uiSurfaceRoute = read(path.join('services', 'api', 'src', 'routes', 'ui_surface.js'));
  const workbenchPackage = read(path.join('apps', 'workbench-ui', 'package.json'));
  const workbenchSmoke = read(path.join('apps', 'workbench-ui', 'tests', 'workbench.authenticated.smoke.spec.mjs'));
  const shellLifecycleDoc = read(path.join('docs', 'architecture', 'OWNER_ADMIN_SHELL_PROFILE_LIFECYCLE.md'));
  const taskEffectModel = read(path.join('docs', 'architecture', 'TASK_EFFECT_MODEL.md'));
  const devManual = read(path.join('docs', 'dev', 'DEVELOPER_MANUAL.md'));

  const engineMustContain = [
    'resolveGovernedEffectType',
    'loadEffectGovernanceMap',
    'EFFECT_TYPE_NOT_GOVERNED',
    'MACRO_CODE_REQUIRED',
  ];
  for (const phrase of engineMustContain) {
    if (!engine.includes(phrase)) {
      failures.push(`core_process_engine.js: missing required phrase ${phrase}`);
    }
  }

  const engineMustNotContain = [
    'const EFFECT_ALIASES',
    'transition?.effects || transition?.effect',
  ];
  for (const phrase of engineMustNotContain) {
    if (engine.includes(phrase)) {
      failures.push(`core_process_engine.js: forbidden legacy pattern ${phrase}`);
    }
  }

  const routeMustContain = [
    'TRANSITION_EFFECTS_INLINE_FORBIDDEN',
    'TRANSITION_MACRO_REQUIRED',
    'SERVICE_OBJECT_TYPE_INVALID',
    'DOCUMENT_CATEGORY_INVALID',
    'DOCUMENT_HEADER_KEY_INVALID',
    '/process/workbench/catalog',
    '/process/workbench/defs/:id',
  ];
  for (const phrase of routeMustContain) {
    if (!processRoute.includes(phrase)) {
      failures.push(`routes/process/core_process.js: missing required phrase ${phrase}`);
    }
  }

  const migrationMustContain = [
    'canonical_effect_code',
    'SERVICE_OBJECT_TYPE',
    'SERVICE_OBJECT_CATEGORY',
    'DOCUMENT_CATEGORY',
    'DOCUMENT_HEADER_KEY',
  ];
  for (const phrase of migrationMustContain) {
    if (!migration0012.includes(phrase)) {
      failures.push(`v2_0012_effect_document_governance.sql: missing required phrase ${phrase}`);
    }
  }

  const migration0013MustContain = [
    'core_process_workbench',
    'ecom_process_workbench',
    '/api/eip/process/workbench/catalog',
    'ProcessDefinitionStudio',
  ];
  for (const phrase of migration0013MustContain) {
    if (!migration0013.includes(phrase)) {
      failures.push(`v2_0013_process_workbench_surface_foundation.sql: missing required phrase ${phrase}`);
    }
  }

  const migration0013MustNotContain = [
    'ECOM_STOREFRONT_CONTENT_FLOW',
    'ECOM_PRODUCT_REVIEW_FLOW',
    'ECOM_BLOG_POST_FLOW',
  ];
  for (const phrase of migration0013MustNotContain) {
    if (migration0013.includes(phrase)) {
      failures.push(`v2_0013_process_workbench_surface_foundation.sql: hardcoded process authority ${phrase}`);
    }
  }

  const migration0014MustContain = [
    'core_process_workbench',
    'ecom_process_workbench',
    'ContractTablePanel',
    'ContractRecordEditor',
    'ui_composition_model',
  ];
  for (const phrase of migration0014MustContain) {
    if (!migration0014.includes(phrase)) {
      failures.push(`v2_0014_workbench_ui_generic_primitive_composition.sql: missing required phrase ${phrase}`);
    }
  }

  const migration0015MustContain = [
    'SplitLayout',
    'generic_primitives_v2',
    'primary_layout',
    'secondary_layout',
    'stream_layout',
  ];
  for (const phrase of migration0015MustContain) {
    if (!migration0015.includes(phrase)) {
      failures.push(`v2_0015_workbench_surface_layout_metadata_composition.sql: missing required phrase ${phrase}`);
    }
  }

  const migration0016MustContain = [
    'ContractDetailEditor',
    'object_merges',
    'from_json_field',
    'generic_primitives_v4',
  ];
  for (const phrase of migration0016MustContain) {
    if (!migration0016.includes(phrase)) {
      failures.push(`v2_0016_definition_studio_primitive_decomposition.sql: missing required phrase ${phrase}`);
    }
  }

  const migration0017MustContain = [
    'owner_admin_shell',
    'layout_variant',
    'tokens',
    'brand.eip_core.logo.light',
    'surface.ecom.review',
  ];
  for (const phrase of migration0017MustContain) {
    if (!migration0017.includes(phrase)) {
      failures.push(`v2_0017_owner_admin_shell_theme_tokens.sql: missing required phrase ${phrase}`);
    }
  }

  const migration0018MustContain = [
    'OWNER_ADMIN_SHELL_PROFILE',
    'OWNER_ADMIN_SHELL_THEME_OVERRIDE',
    'shell_profile_code',
    'dropdown_value',
    'owner_admin_shell',
  ];
  for (const phrase of migration0018MustContain) {
    if (!migration0018.includes(phrase)) {
      failures.push(`v2_0018_owner_admin_shell_profile_layer.sql: missing required phrase ${phrase}`);
    }
  }

  const migration0019MustContain = [
    'ui_shell_profile',
    'ui_shell_profile_revision',
    'ui_shell_profile_event',
    'ui_shell_profile_create_draft',
    'ui_shell_profile_publish',
    'ui_shell_profile_rollback_publish',
    'OWNER_ADMIN_SHELL_PROFILE_SELECTION',
    'draft',
    'published',
    'archived',
  ];
  for (const phrase of migration0019MustContain) {
    if (!migration0019.includes(phrase)) {
      failures.push(`v2_0019_owner_admin_shell_profile_lifecycle.sql: missing required phrase ${phrase}`);
    }
  }

  const docsMustContain = [
    ['docs/architecture/OWNER_ADMIN_SHELL_PROFILE_LIFECYCLE.md', shellLifecycleDoc, 'ui_shell_profile_revision'],
    ['docs/architecture/OWNER_ADMIN_SHELL_PROFILE_LIFECYCLE.md', shellLifecycleDoc, 'OWNER_ADMIN_SHELL_PROFILE_SELECTION'],
    ['docs/architecture/OWNER_ADMIN_SHELL_PROFILE_LIFECYCLE.md', shellLifecycleDoc, 'rollback'],
    ['docs/architecture/TASK_EFFECT_MODEL.md', taskEffectModel, 'canonical_effect_code'],
    ['docs/dev/DEVELOPER_MANUAL.md', devManual, 'SERVICE_OBJECT_TYPE'],
    ['docs/dev/DEVELOPER_MANUAL.md', devManual, 'DOCUMENT_CATEGORY'],
    ['docs/dev/DEVELOPER_MANUAL.md', devManual, '/process/workbench/catalog'],
    ['docs/dev/DEVELOPER_MANUAL.md', devManual, '/api/eip/ui/surfaces'],
    ['docs/dev/DEVELOPER_MANUAL.md', devManual, 'components/primitives'],
    ['docs/dev/DEVELOPER_MANUAL.md', devManual, 'components/composites'],
    ['docs/dev/DEVELOPER_MANUAL.md', devManual, 'components/shell'],
    ['docs/dev/DEVELOPER_MANUAL.md', devManual, 'OWNER_ADMIN_SHELL_PROFILE'],
    ['docs/dev/DEVELOPER_MANUAL.md', devManual, 'shell_profile_code'],
    ['docs/dev/DEVELOPER_MANUAL.md', devManual, 'OWNER_ADMIN_SHELL_PROFILE_SELECTION'],
    ['docs/dev/DEVELOPER_MANUAL.md', devManual, 'ui_shell_profile_publish'],
  ];

  for (const [name, text, phrase] of docsMustContain) {
    if (!text.includes(phrase)) {
      failures.push(`${name}: missing required phrase ${phrase}`);
    }
  }

  const frontendMustContain = [
    ['apps/workbench-ui/src/App.jsx', workbenchApp, 'useSurfaceLoader'],
    ['apps/workbench-ui/src/App.jsx', workbenchApp, 'useSurfaceCatalog'],
    ['apps/workbench-ui/src/App.jsx', workbenchApp, 'readSurfaceSelectionHint'],
    ['apps/workbench-ui/src/hooks/useSurfaceLoader.js', surfaceLoader, '/api/eip/ui/surfaces/'],
    ['apps/workbench-ui/src/hooks/useSurfaceCatalog.js', surfaceCatalog, '/api/eip/ui/surfaces'],
    ['apps/workbench-ui/src/engine/surfaceCache.js', surfaceCache, 'tenant:'],
    ['services/api/src/routes/ui_surface.js', uiSurfaceRoute, '/ui/surfaces'],
    ['services/api/src/routes/ui_surface.js', uiSurfaceRoute, 'buildCatalogEtag'],
    ['services/api/src/routes/ui_surface.js', uiSurfaceRoute, 'OWNER_SHELL_SELECTION_SETTING_KEY'],
    ['services/api/src/routes/ui_surface.js', uiSurfaceRoute, 'ui_shell_profile_published'],
    ['services/api/src/routes/ui_surface.js', uiSurfaceRoute, 'theme_version_token'],
    ['apps/workbench-ui/src/engine/renderer.jsx', workbenchRenderer, 'renderNode'],
    ['apps/workbench-ui/src/engine/themeGovernance.js', workbenchTheme, 'resolveOwnerAdminTheme'],
    ['apps/workbench-ui/src/engine/themeGovernance.js', workbenchTheme, 'layout_variant'],
    ['apps/workbench-ui/src/components/shell/OwnerAdminShell.jsx', ownerAdminShell, 'Reload Surfaces'],
    ['apps/workbench-ui/src/components/shell/OwnerAdminShell.jsx', ownerAdminShell, 'data-surface-code'],
    ['apps/workbench-ui/src/components/shell/OwnerAdminShell.jsx', ownerAdminShell, 'Refresh Session'],
    ['apps/workbench-ui/src/components/shell/OwnerAdminShell.jsx', ownerAdminShell, 'Copy tenant_id'],
    ['apps/workbench-ui/src/engine/registry.jsx', workbenchRegistry, 'primitiveLibrary'],
    ['apps/workbench-ui/src/engine/registry.jsx', workbenchRegistry, 'compositeLibrary'],
    ['apps/workbench-ui/src/engine/registry.jsx', workbenchRegistry, 'SplitLayout'],
    ['apps/workbench-ui/src/engine/registry.jsx', workbenchRegistry, 'ContractTablePanel'],
    ['apps/workbench-ui/src/engine/registry.jsx', workbenchRegistry, 'ContractRecordEditor'],
    ['apps/workbench-ui/src/engine/registry.jsx', workbenchRegistry, 'ContractDetailEditor'],
    ['apps/workbench-ui/src/App.jsx', workbenchApp, './components/shell/LoginPanel.jsx'],
    ['apps/workbench-ui/src/App.jsx', workbenchApp, './components/shell/OwnerAdminShell.jsx'],
    ['apps/workbench-ui/src/App.jsx', workbenchApp, './components/primitives/StateNotice.jsx'],
    ['apps/workbench-ui/package.json', workbenchPackage, 'test:smoke'],
    ['apps/workbench-ui/tests/workbench.authenticated.smoke.spec.mjs', workbenchSmoke, 'core_process_workbench'],
    ['apps/workbench-ui/tests/workbench.authenticated.smoke.spec.mjs', workbenchSmoke, 'ecom_process_workbench'],
    ['apps/workbench-ui/tests/workbench.authenticated.smoke.spec.mjs', workbenchSmoke, 'Permission required'],
    ['apps/workbench-ui/tests/workbench.authenticated.smoke.spec.mjs', workbenchSmoke, '/api/eip/auth/logout'],
  ];

  for (const [name, text, phrase] of frontendMustContain) {
    if (!text.includes(phrase)) {
      failures.push(`${name}: missing required phrase ${phrase}`);
    }
  }

  const frontendMustNotContain = [
    ['apps/workbench-ui/src/App.jsx', workbenchApp, 'owner_admin_shell'],
  ];
  for (const [name, text, phrase] of frontendMustNotContain) {
    if (text.includes(phrase)) {
      failures.push(`${name}: legacy shell theme source still referenced (${phrase})`);
    }
  }

  const primitiveStart = workbenchRegistry.indexOf('const primitiveLibrary');
  const compositeStart = workbenchRegistry.indexOf('const compositeLibrary');
  const primitiveBlock = primitiveStart >= 0
    ? workbenchRegistry.slice(primitiveStart, compositeStart > primitiveStart ? compositeStart : undefined)
    : '';

  const forbiddenPrimitiveComposites = [
    'ProcessWorkbenchCatalog',
    'ProcessDefinitionStudio',
    'TaskTemplateWorkbench',
    'ProcessBindingWorkbench',
    'ProcessInstanceStream',
  ];

  for (const phrase of forbiddenPrimitiveComposites) {
    if (primitiveBlock.includes(phrase)) {
      failures.push(`apps/workbench-ui/src/engine/registry.jsx: composite leaked into primitiveLibrary (${phrase})`);
    }
  }

  const forbiddenRegisteredComposites = [
    'ProcessDefinitionStudio',
    'ProcessWorkbenchCatalog',
    'TaskTemplateWorkbench',
    'ProcessBindingWorkbench',
    'ProcessInstanceStream',
  ];
  for (const phrase of forbiddenRegisteredComposites) {
    if (workbenchRegistry.includes(phrase)) {
      failures.push(`apps/workbench-ui/src/engine/registry.jsx: legacy workbench composite must not stay registered (${phrase})`);
    }
  }

  const componentsDir = path.join(root, 'apps', 'workbench-ui', 'src', 'components');
  const requiredComponentDirs = ['primitives', 'composites', 'shell'];
  for (const subdir of requiredComponentDirs) {
    const target = path.join(componentsDir, subdir);
    if (!fs.existsSync(target)) {
      failures.push(`apps/workbench-ui/src/components/${subdir}: missing component namespace directory`);
    }
  }

  if (fs.existsSync(componentsDir)) {
    const topLevelEntries = fs.readdirSync(componentsDir, { withFileTypes: true });
    const strayTopLevelFiles = topLevelEntries
      .filter((entry) => entry.isFile() && (entry.name.endsWith('.jsx') || entry.name.endsWith('.js')))
      .map((entry) => entry.name);
    if (strayTopLevelFiles.length > 0) {
      failures.push(`apps/workbench-ui/src/components: stray top-level component files (${strayTopLevelFiles.join(', ')})`);
    }
  }
}

if (failures.length > 0) {
  console.error('Process governance validation failed.');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Process governance validation passed.');
