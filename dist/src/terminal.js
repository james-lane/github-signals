const sgr = /^\x1b\[[0-9;]*m$/;
export const sanitizeTerminal = (value) => String(value ?? '')
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[(?![0-9;]*m)[0-?]*[ -\/]*[@-~]/g, '')
    .split(/(\x1b\[[0-9;]*m)/)
    .map((part) => sgr.test(part) ? part : part.replace(/[\u0000-\u001f\u007f-\u009f]/g, ''))
    .join('');
//# sourceMappingURL=terminal.js.map