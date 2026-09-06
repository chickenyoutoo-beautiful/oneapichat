const assert = require('assert');
const fs = require('fs');

const imageGen = fs.readFileSync('public/js/image-gen.js', 'utf8');
const toolsExec = fs.readFileSync('public/js/tools-exec.js', 'utf8');
const tools = fs.readFileSync('public/js/tools.js', 'utf8');
const engine = fs.readFileSync('python/engine_server.py', 'utf8');
const main = fs.readFileSync('public/js/main.js', 'utf8');
const dialogs = fs.readFileSync('public/js/dialogs.js', 'utf8');

assert(imageGen.includes("localStorage.getItem('visionProvider')"), 'video analyzer must read selected vision provider');
assert(imageGen.includes("localStorage.getItem('visionModel')"), 'video analyzer must read selected vision model');
assert(imageGen.includes("window.analyzeImage(frame, focus)"), 'video frames must reuse configured image vision pipeline');
assert(imageGen.includes("[2, 1.25, 0.7, 0.3, 0.08]"), 'ending questions must sample the final two seconds densely');
assert(imageGen.includes("关键帧已成功提取，但所选视觉模型分析失败"), 'vision failures must be explicit instead of silently claiming no permission');
assert(!/catch\(e\) \{\}\s*\/\/ 3\. 构建结果/.test(imageGen), 'frame extraction errors must not be swallowed');
assert(toolsExec.includes("vf.serverPath || vf.serverUrl || vf.content"), 'uploaded server path must be preferred');
assert(toolsExec.includes("_nativeLocalTools.has(func.name)"), 'native video tools must bypass same-name MCP routing');
assert(toolsExec.includes("!_nativeLocalTools.has(func.name)"), 'generic MCP fallback must exclude native video tools');
assert(toolsExec.includes("func.name !== 'video_understanding' && func.name !== 'video_edit'"), 'broad video_* MCP route must exclude native understanding and edit tools');
assert(!toolsExec.includes("func.name === 'video_understanding' || func.name === 'analyze_image' || func.name === 'rag_search'"), 'native video/image tools must not enter explicit MCP fallback');
assert(main.includes("if (_mcpName && !_nativeNames.has(_mcpName))"), 'MCP schemas must not duplicate native video tools');
assert(dialogs.includes("serverPath: f.serverPath || ''"), 'slim persistence must preserve uploaded video serverPath');
assert(toolsExec.includes("+ '::' + query"), 'video cache must be query-sensitive');
assert(tools.includes('不要声称无法读取视频或要求用户另行截图'), 'tool prompt must direct the model to use video analysis');
assert(engine.includes('requested = params.get("timestamps")'), 'engine must support explicit timestamps');
assert(engine.includes('duration - 0.08'), 'default frame extraction must include the final frame');
assert(engine.includes('"timestamps": actual_timestamps'), 'engine must return actual frame timestamps');

console.log('✅ video_understanding.test.js: all assertions passed');
