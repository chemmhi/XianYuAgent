// Runs in the observed page. Values are preserved, not spoofed or normalized.
export async function readFingerprint() {
  const attempt = async (fn) => { try { return await fn(); } catch (error) { return { error: String(error) }; } };
  const nav = {};
  for (const key of ['userAgent', 'appVersion', 'platform', 'vendor', 'product', 'productSub', 'vendorSub', 'language', 'languages', 'webdriver', 'hardwareConcurrency', 'deviceMemory', 'maxTouchPoints', 'cookieEnabled', 'onLine', 'doNotTrack', 'pdfViewerEnabled']) nav[key] = navigator[key] ?? null;
  const highEntropy = await attempt(() => navigator.userAgentData?.getHighEntropyValues(['architecture', 'bitness', 'model', 'platformVersion', 'uaFullVersion', 'fullVersionList', 'wow64', 'formFactors']));
  const graphics = await attempt(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 480; canvas.height = 120;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f60'; ctx.fillRect(10, 10, 130, 70);
    ctx.font = '18px Arial'; ctx.fillStyle = '#069'; ctx.fillText('Xianyu fingerprint 中文 123 😀', 15, 45);
    const image = canvas.toDataURL();
    const gl = document.createElement('canvas').getContext('webgl');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    const values = gl ? Object.fromEntries(['VERSION', 'SHADING_LANGUAGE_VERSION', 'VENDOR', 'RENDERER', 'MAX_TEXTURE_SIZE', 'MAX_RENDERBUFFER_SIZE', 'MAX_VERTEX_ATTRIBS', 'MAX_VIEWPORT_DIMS', 'ALIASED_LINE_WIDTH_RANGE', 'ALIASED_POINT_SIZE_RANGE'].map((name) => { const value = gl.getParameter(gl[name]); return [name, ArrayBuffer.isView(value) ? Array.from(value) : value]; })) : null;
    return { canvasDataUrl: image, parameters: values, extensions: gl?.getSupportedExtensions(), unmaskedVendor: ext && gl.getParameter(ext.UNMASKED_VENDOR_WEBGL), unmaskedRenderer: ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) };
  });
  const audio = await attempt(async () => {
    const context = new OfflineAudioContext(1, 5000, 44100);
    const oscillator = context.createOscillator(); oscillator.type = 'triangle'; oscillator.frequency.value = 10000;
    const compressor = context.createDynamicsCompressor(); oscillator.connect(compressor); compressor.connect(context.destination); oscillator.start();
    const output = await context.startRendering();
    return { sampleRate: output.sampleRate, samples: Array.from(output.getChannelData(0)) };
  });
  return {
    url: location.href, observedAt: new Date().toISOString(), navigator: nav,
    userAgentData: navigator.userAgentData?.toJSON(), highEntropy,
    screen: Object.fromEntries(['width', 'height', 'availWidth', 'availHeight', 'availLeft', 'availTop', 'colorDepth', 'pixelDepth', 'isExtended'].map((key) => [key, screen[key] ?? null])),
    window: { innerWidth, innerHeight, outerWidth, outerHeight, screenX, screenY, devicePixelRatio, isSecureContext, crossOriginIsolated },
    timezone: Intl.DateTimeFormat().resolvedOptions(), timezoneOffset: new Date().getTimezoneOffset(),
    plugins: [...navigator.plugins].map((p) => ({ name: p.name, filename: p.filename, description: p.description, mimeTypes: [...p].map((m) => ({ type: m.type, suffixes: m.suffixes, description: m.description })) })),
    permissions: await attempt(async () => Object.fromEntries(await Promise.all(['geolocation', 'notifications', 'camera', 'microphone', 'clipboard-read', 'persistent-storage'].map(async (name) => [name, await attempt(async () => (await navigator.permissions.query({ name })).state)])))),
    media: await attempt(async () => (await navigator.mediaDevices.enumerateDevices()).map((d) => ({ kind: d.kind, deviceId: d.deviceId, groupId: d.groupId, label: d.label }))),
    connection: navigator.connection ? { effectiveType: navigator.connection.effectiveType, rtt: navigator.connection.rtt, downlink: navigator.connection.downlink, saveData: navigator.connection.saveData } : null,
    fonts: ['Arial', 'Calibri', 'Cambria', 'Consolas', 'Courier New', 'Georgia', 'Microsoft YaHei', 'SimSun', 'Times New Roman', 'Verdana', 'Segoe UI'].map((name) => ({ name, available: document.fonts.check(`16px "${name}"`) })),
    graphics, audio,
    mediaQueries: Object.fromEntries(['(prefers-color-scheme: dark)', '(prefers-reduced-motion: reduce)', '(forced-colors: active)', '(pointer: fine)', '(hover: hover)', '(color-gamut: p3)'].map((query) => [query, matchMedia(query).matches])),
    storage: await attempt(async () => ({ localStorage: { ...localStorage }, sessionStorage: { ...sessionStorage }, estimate: await navigator.storage?.estimate() })),
    document: { visibility: document.visibilityState, hasFocus: document.hasFocus(), referrer: document.referrer },
  };
}
