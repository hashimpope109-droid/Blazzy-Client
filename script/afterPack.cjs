const fs = require('fs');
const path = require('path');

/**
 * electron-builder afterPack hook
 * Strips unused fallback software rasterizers on platforms where they are not
 * required. Windows keeps SwiftShader and d3dcompiler because Electron can need
 * them to create its first window on machines with older or disabled GPU drivers.
 */
exports.default = async function (context) {
  const { appOutDir, electronPlatformName } = context;

  // Candidate unused files to prune across platforms
  const targets = [];

  if (electronPlatformName === 'darwin') {
    const libDir = path.join(
      appOutDir,
      `${context.packager.appInfo.productFilename}.app`,
      'Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries'
    );
    targets.push(
      path.join(libDir, 'libvk_swiftshader.dylib'),
      path.join(libDir, 'vk_swiftshader_icd.json')
    );
  } else if (electronPlatformName === 'linux') {
    targets.push(
      path.join(appOutDir, 'libvk_swiftshader.so'),
      path.join(appOutDir, 'vk_swiftshader_icd.json')
    );
  }

  for (const file of targets) {
    try {
      if (fs.existsSync(file)) {
        await fs.promises.unlink(file);
      }
    } catch {
      // Ignore cleanup errors
    }
  }
};
