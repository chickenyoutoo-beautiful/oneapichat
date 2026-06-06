// files.js — 文件处理 v1.0 (Phase 6)
// 文件读写/预览/上传/粘贴/拖拽

// ==================== 文件处理 ====================
async function extractFileContent(file) {
    var ext = file.name.split('.').pop().toLowerCase();
    if (file.type.startsWith('text/') || ['txt', 'md', 'js', 'py', 'json', 'html', 'css', 'xml', 'csv', 'log', 'sh', 'bat', 'conf', 'ini'].includes(ext)) {
        return new Promise((resolve, reject) => {
            var fr = new FileReader();
            fr.onload = e => resolve(e.target.result);
            fr.onerror = reject;
            fr.readAsText(file);
        });
    }
    if (ext === 'docx' || file.type.includes('word')) {
        var _ab = await file.arrayBuffer();
        var _docText = '';
        var _docImages = [];

        // ★ 1) 尝试 mammoth 提取文本
        if (window.mammoth) {
            try {
                var _result = await mammoth.extractRawText({ arrayBuffer: _ab });
                if (_result.value && _result.value.trim().length > 20) _docText = _result.value;
            } catch(e) {
                console.warn('[docx] mammoth 解析失败，降级为原始提取:', e.message);
            }
        }
        // ★ 2) mammoth 失败 → 原始 XML 文本提取
        if (!_docText) {
            var _raw = new TextDecoder('utf-8', {fatal: false}).decode(_ab);
            var _texts = [];
            var _re = /<w:t[^>]*>([^<]*)<\/w:t>/g; let _m;
            while ((_m = _re.exec(_raw)) !== null) {
                if (_m[1]) _texts.push(_m[1]);
            }
            if (_texts.length > 0) {
                _docText = _texts.join('');
            } else {
                var _plain = [];
                var _re2 = />([^<]{2,})</g; let _m2;
                while ((_m2 = _re2.exec(_raw)) !== null) {
                    var _t = _m2[1].replace(/&[a-z]+;/g, ' ').trim();
                    if (_t.length > 1) _plain.push(_t);
                }
                _docText = _plain.length > 0 ? '[DOCX] （文件已损坏，尽力提取碎片文本）\n\n' + _plain.slice(0, 200).join(' ') : '';
            }
        }

        // ★ 3) 提取内嵌图片（word/media/ 目录）
        if (window.JSZip) {
            try {
                var _docZip = await JSZip.loadAsync(_ab);
                var _mediaFiles = Object.keys(_docZip.files).filter(function(f) {
                    return /^word\/media\//i.test(f) && !/\.xml$/i.test(f);
                });
                var _imgLimit = Math.min(_mediaFiles.length, 20);
                for (var _mi = 0; _mi < _imgLimit; _mi++) {
                    try {
                        var _mf = _mediaFiles[_mi];
                        var _mdata = await _docZip.files[_mf].async('uint8array');
                        if (_mdata.length > 5 * 1024 * 1024) continue;
                        var _ext = (_mf.split('.').pop() || 'png').toLowerCase();
                        if (['png','jpg','jpeg','gif','webp','bmp','svg','emf','wmf'].indexOf(_ext) < 0) continue;
                        var _mime = 'image/' + (_ext === 'jpg' ? 'jpeg' : _ext === 'emf' ? 'png' : _ext === 'wmf' ? 'png' : _ext);
                        var _b64 = '';
                        var _chunk = 8192;
                        for (var _bi = 0; _bi < _mdata.length; _bi += _chunk) {
                            _b64 += String.fromCharCode.apply(null, Array.prototype.slice.call(_mdata, _bi, Math.min(_bi + _chunk, _mdata.length)));
                        }
                        _b64 = btoa(_b64);
                        _docImages.push({
                            name: _mf.replace(/^word\/media\//i, ''),
                            dataUrl: 'data:' + _mime + ';base64,' + _b64,
                            size: _mdata.length
                        });
                    } catch(e) { /* 跳过损坏图片 */ }
                }
            } catch(e) { console.warn('[docx] 图片提取失败:', e.message); }
        }

        // ★ 4) 返回结果
        if (_docImages.length > 0) {
            _docText += '\n\n【DOCX 内嵌图片 ' + _docImages.length + ' 张】';
            _docImages.forEach(function(img, idx) {
                _docText += '\n  ' + (idx + 1) + '. ' + img.name + ' (' + (img.size / 1024).toFixed(0) + 'KB)';
            });
            return { text: _docText || '[DOCX] 仅提取到图片', images: _docImages, isOfficeDoc: true };
        }
        return _docText || '[DOCX] 无法提取文本。文件可能已损坏，请尝试用 Word 重新保存后再上传。';
    }
    if (['xlsx', 'xls', 'xlsm'].includes(ext) || file.type.includes('spreadsheet')) {
        if (!window.XLSX) throw new Error('SheetJS 未加载');
        var wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
        return wb.SheetNames.map((name, i) => `【工作表 ${i + 1}: ${name}】\n` + XLSX.utils.sheet_to_csv(wb.Sheets[name], { FS: '\t', RS: '\n' })).join('\n\n');
    }
    if (ext === 'pptx' || ext === 'ppt') {
        if (!window.JSZip) throw new Error('JSZip 未加载，请刷新页面后重试');
        var arrayBuf;
        try {
            arrayBuf = await file.arrayBuffer();
        } catch(e) {
            throw new Error('文件读取失败，可能已损坏');
        }
        // ★ 校验文件头：PPTX 是 ZIP 格式 (PK\x03\x04)
        var header = new Uint8Array(arrayBuf.slice(0, 4));
        var isZip = header[0] === 0x50 && header[1] === 0x4b;
        if (!isZip) {
            throw new Error('不是有效的 PPTX 文件（PPTX 需为 Office 2007+ 格式，旧 .ppt 格式不支持）');
        }
        var zip;
        try {
            zip = await JSZip.loadAsync(arrayBuf);
        } catch(zipErr) {
            // ★ JSZip 失败 → 多级降级提取
            console.warn('[pptx] JSZip 解析失败，降级提取:', zipErr.message);
            var _raw2 = new TextDecoder('utf-8', {fatal: false}).decode(arrayBuf);

            // 1) 尝试 XML <a:t> 标签提取
            var _texts2 = [];
            var _re2 = /<a:t[^>]*>([^<]*)<\/a:t>/g; let _m2;
            while ((_m2 = _re2.exec(_raw2)) !== null) {
                if (_m2[1] && _m2[1].trim()) _texts2.push(_m2[1].trim());
            }
            if (_texts2.length > 0) {
                return '[PPTX] （文件部分损坏，已尽力提取）\n\n' + _texts2.join(' ');
            }

            // 2) 尝试提取所有 XML 标签之间的可读文本
            var _plainTexts = [];
            var _re3 = />([^<]{2,})</g; let _m3;
            while ((_m3 = _re3.exec(_raw2)) !== null) {
                var _t = _m3[1].replace(/&[a-z]+;/g, ' ').trim();
                if (_t.length > 1 && !/^[\x00-\x08\x0b\x0c\x0e-\x1f]+$/.test(_t)) {
                    _plainTexts.push(_t);
                }
            }
            if (_plainTexts.length > 0) {
                return '[PPTX] （文件已损坏，以下为尽力提取的碎片文本）\n\n' + _plainTexts.slice(0, 200).join(' ');
            }

            // 3) 完全无法提取 — 明确告知用户
            var _errDetail = zipErr.message || '';
            if (_errDetail.indexOf('End of data') >= 0 || _errDetail.indexOf('central directory') >= 0) {
                throw new Error('此 PPTX 文件已损坏（ZIP 结构不完整）。请尝试：1) 用 PowerPoint 重新保存文件 2) 另存为新副本后再上传');
            }
            if (_raw2.indexOf('ppt/slides') < 0 && _raw2.indexOf('Presentation') < 0) {
                throw new Error('不是有效的 PPTX 文件。PPTX 需为 Office 2007+ 格式（.pptx），旧 .ppt 格式不支持。请用 PowerPoint 另存为 .pptx 格式');
            }
            throw new Error('PPTX 文件无法解析，文件可能已损坏或格式不兼容。请尝试重新保存后再上传');
        }
        // ★ 同时提取图片（ppt/media/ 目录）
        var _mediaFiles = Object.keys(zip.files).filter(function(f) {
            return /^ppt\/media\//i.test(f) && !/\.xml$/i.test(f);
        });
        var _extractedImages = [];
        // 限制：最多 20 张图，每张最大 5MB base64
        var _imgLimit = Math.min(_mediaFiles.length, 20);
        for (var _mi = 0; _mi < _imgLimit; _mi++) {
            try {
                var _mf = _mediaFiles[_mi];
                var _mdata = await zip.files[_mf].async('uint8array');
                if (_mdata.length > 5 * 1024 * 1024) continue; // 跳过超大图
                var _ext = (_mf.split('.').pop() || 'png').toLowerCase();
                if (['png','jpg','jpeg','gif','webp','bmp','svg'].indexOf(_ext) < 0) continue;
                var _mime = 'image/' + (_ext === 'jpg' ? 'jpeg' : _ext);
                // uint8array → base64
                var _b64 = '';
                var _chunk = 8192;
                for (var _bi = 0; _bi < _mdata.length; _bi += _chunk) {
                    _b64 += String.fromCharCode.apply(null, Array.prototype.slice.call(_mdata, _bi, _bi + _chunk));
                }
                _b64 = btoa(_b64);
                _extractedImages.push({
                    name: _mf.replace(/^ppt\/media\//i, ''),
                    dataUrl: 'data:' + _mime + ';base64,' + _b64,
                    size: _mdata.length
                });
            } catch(e) { /* 跳过损坏的图片 */ }
        }

        // PPTX 中幻灯片在 ppt/slides/slideN.xml 中
        var slideFiles = Object.keys(zip.files).filter(f => /^ppt\/slides\/slide\d+\.xml$/i.test(f)).sort();
        if (!slideFiles.length) {
            if (_extractedImages.length > 0) {
                return { text: '[PPTX] 未找到文字内容，但提取到 ' + _extractedImages.length + ' 张图片', images: _extractedImages, isOfficeDoc: true };
            }
            return '[PPTX] 未找到幻灯片内容,请确认文件格式正确。';
        }
        var slideTexts = [];
        var MAX_SLIDE_CHARS = 5000;  // 每张幻灯片最多取前5000字符
        var MAX_TOTAL_CHARS = 80000; // 整个PPT最多取80000字符
        let totalChars = 0;
        for (let i = 0; i < slideFiles.length; i++) {
            if (totalChars >= MAX_TOTAL_CHARS) {
                slideTexts.push('...(后续' + (slideFiles.length - i) + '张幻灯片因内容过长已截断)');
                break;
            }
            var xmlStr = await zip.files[slideFiles[i]].async('text');
            // 提取 a:t 标签内的文本(PPTX 文本存放在 <a:t>text</a:t>)
            var texts = [];
            var regex = /<a:t[^>]*>([^<]*)<\/a:t>/g;
            var match;
            while ((match = regex.exec(xmlStr)) !== null) {
                if (match[1].trim()) texts.push(match[1].trim());
            }
            var slideText = texts.join(' ');
            if (slideText.trim()) {
                // 单张幻灯片截断
                if (slideText.length > MAX_SLIDE_CHARS) {
                    slideText = slideText.substring(0, MAX_SLIDE_CHARS) + '...(本页过长已截断)';
                }
                var slideEntry = '【幻灯片 ' + (i + 1) + '】' + slideText;
                totalChars += slideEntry.length;
                slideTexts.push(slideEntry);
            }
        }
        var result = slideTexts.length ? slideTexts.join('\n\n') : '[PPTX] 解析完成,未提取到文字内容。';
        if (result.length > MAX_TOTAL_CHARS + 200) {
            result = result.substring(0, MAX_TOTAL_CHARS) + '\n\n...(内容过长已截断)';
        }
        // ★ 附加图片信息到文本末尾（文本模型也能知道有哪些图）
        if (_extractedImages.length > 0) {
            result += '\n\n【PPTX 内嵌图片 ' + _extractedImages.length + ' 张】';
            _extractedImages.forEach(function(img, idx) {
                result += '\n  ' + (idx + 1) + '. ' + img.name + ' (' + (img.size / 1024).toFixed(0) + 'KB)';
            });
        }
        // 返回对象：文本 + 图片数据
        return { text: result, images: _extractedImages, isOfficeDoc: true };
    }
    // fallback
    return new Promise((resolve, reject) => {
        var fr = new FileReader();
        fr.onload = e => resolve(e.target.result);
        fr.onerror = reject;
        fr.readAsText(file);
    });
}

function updateFilePreviewUI() {
    var container = $.filePreviewContainer;
    if (!container) return;
    container.innerHTML = '';
    if (!pendingFiles.length) {
        container.classList.add('hidden');
        return;
    }
    container.classList.remove('hidden');

    // ★ 统一卡片网格：图片缩略图 + 非图片文件卡片
    var grid = document.createElement('div');
    grid.className = 'file-card-grid';

    pendingFiles.forEach(function(f, i) {
        var isImg = f.isImage || (f.type && f.type.startsWith('image/'));
        var card = document.createElement('div');
        card.className = 'file-card-item';
        card.onclick = function(e) { e.stopPropagation(); window._previewUploadedFile(i); };

        // 预览区
        var preview = document.createElement('div');
        preview.className = 'file-card-preview';
        if (isImg) {
            var img = document.createElement('img');
            img.className = 'file-card-img';
            img.src = f.content || '';
            img.alt = f.name;
            preview.appendChild(img);
            // 放大图标
            var zoom = document.createElement('div');
            zoom.className = 'file-card-zoom';
            zoom.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>';
            preview.appendChild(zoom);
        } else {
            // 文件类型图标
            var ext = (f.name || '').split('.').pop().toLowerCase();
            var icon = _fileTypeIcon(ext);
            preview.innerHTML = '<div class="file-card-icon">' + icon + '</div>';
        }

        // 信息栏
        var info = document.createElement('div');
        info.className = 'file-card-info';
        var nameEl = document.createElement('div');
        nameEl.className = 'file-card-name';
        nameEl.textContent = f.name;
        var sizeEl = document.createElement('div');
        sizeEl.className = 'file-card-size';
        sizeEl.textContent = _formatFileSize(f.size);

        // 删除按钮
        var remove = document.createElement('button');
        remove.className = 'file-card-remove';
        remove.innerHTML = '&#x2715;';
        remove.onclick = function(e) { e.stopPropagation(); window.removeFile(i); };

        info.appendChild(nameEl);
        info.appendChild(sizeEl);
        card.appendChild(preview);
        card.appendChild(info);
        card.appendChild(remove);
        grid.appendChild(card);
    });

    container.appendChild(grid);
}

/** 文件类型图标 */
function _fileTypeIcon(ext) {
    var icons = {
        pdf: '<svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><text x="8" y="18" font-size="5" fill="#ef4444" font-weight="bold">PDF</text></svg>',
        txt: '<svg viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="12" y2="17"/></svg>',
        md: '<svg viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>',
        doc: '<svg viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><text x="7" y="18" font-size="5" fill="#2563eb" font-weight="bold">DOC</text></svg>',
        json: '<svg viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><text x="7" y="18" font-size="4.5" fill="#f59e0b" font-weight="bold">JSON</text></svg>',
        js: '<svg viewBox="0 0 24 24" fill="none" stroke="#eab308" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><text x="8" y="18" font-size="5" fill="#eab308" font-weight="bold">JS</text></svg>',
    };
    // 默认文件图标
    return icons[ext] || '<svg viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
}

function _formatFileSize(bytes) {
    if (!bytes || bytes < 1024) return (bytes || 0) + 'B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + 'KB';
    return (bytes / 1048576).toFixed(1) + 'MB';
}

/** 点击文件卡片预览 */
window._previewUploadedFile = function(index) {
    var f = pendingFiles[index];
    if (!f || !f.content) return;
    var isImg = f.isImage || (f.type && f.type.startsWith('image/'));
    if (isImg) {
        // 图片大图预览
        var overlay = document.createElement('div');
        overlay.className = 'file-preview-overlay';
        overlay.onclick = function() { overlay.remove(); };
        var img = document.createElement('img');
        img.className = 'file-preview-large';
        img.src = f.content;
        overlay.appendChild(img);
        document.body.appendChild(overlay);
    } else {
        // 文本文件内容预览
        var content = f.content || '';
        var isText = f.name && /\.(txt|md|json|js|ts|jsx|tsx|html|css|xml|yaml|yml|py|php|go|rs|sh|log|conf|ini|cfg|csv|sql|env)$/i.test(f.name);
        if (isText && content.length < 500000) {
            var overlay2 = document.createElement('div');
            overlay2.className = 'file-preview-overlay';
            overlay2.onclick = function(e) { if (e.target === overlay2) overlay2.remove(); };
            var box = document.createElement('div');
            box.className = 'file-preview-text-box';
            box.onclick = function(e) { e.stopPropagation(); };
            var header = document.createElement('div');
            header.className = 'file-preview-header';
            header.innerHTML = '<strong>' + escapeHtml(f.name) + '</strong> (' + _formatFileSize(f.size) + ')<button class="file-preview-close" onclick="this.closest(\'.file-preview-overlay\').remove()">&#x2715;</button>';
            var pre = document.createElement('pre');
            pre.className = 'file-preview-content';
            pre.textContent = content.substring(0, 50000);
            box.appendChild(header);
            box.appendChild(pre);
            overlay2.appendChild(box);
            document.body.appendChild(overlay2);
        } else {
            // 非文本文件：提示无法预览
            showToast('📄 ' + f.name + ' (' + _formatFileSize(f.size) + ') — 无法预览此文件类型', 'info', 3000);
        }
    }
};

window.removeFile = i => {
    pendingFiles.splice(i, 1);
    updateFilePreviewUI();
    if ($.fileInput) $.fileInput.value = '';
};

function clearAllFiles() {
    pendingFiles = [];
    updateFilePreviewUI();
    if ($.fileInput) $.fileInput.value = '';
}

// ★ 粘贴图片支持: 监听输入框 paste 事件,自动将剪贴板图片转为 pendingFiles
function setupPasteImageSupport() {
    if (!$.userInput) return;
    $.userInput.addEventListener('paste', async function(e) {
        var items = (e.clipboardData || window.clipboardData)?.items;
        if (!items) return;
        var imageItems = [];
        for (var i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                imageItems.push(items[i]);
            }
        }
        if (!imageItems.length) return; // 没有图片,正常粘贴文字
        e.preventDefault(); // 阻止默认粘贴(避免 base64 出现在输入框)
        for (var j = 0; j < imageItems.length; j++) {
            var blob = imageItems[j].getAsFile();
            if (!blob) continue;
            var reader = new FileReader();
            await new Promise(function(resolve) {
                reader.onload = function() {
                    var dataUrl = reader.result;
                    // 压缩大图
                    if (dataUrl.length > 500 * 1024) {
                        var img = new Image();
                        img.onload = function() {
                            var canvas = document.createElement('canvas');
                            var maxW = 1920, maxH = 1920;
                            var scale = Math.min(maxW / img.width, maxH / img.height, 1);
                            canvas.width = img.width * scale;
                            canvas.height = img.height * scale;
                            var ctx = canvas.getContext('2d');
                            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                            dataUrl = canvas.toDataURL('image/webp', 0.85);
                            addPastedImage(dataUrl, blob.name || 'clipboard.png', dataUrl.length);
                            resolve();
                        };
                        img.src = dataUrl;
                    } else {
                        addPastedImage(dataUrl, blob.name || 'clipboard.png', dataUrl.length);
                        resolve();
                    }
                };
                reader.readAsDataURL(blob);
            });
        }
        updateFilePreviewUI();
    });
}

function addPastedImage(dataUrl, name, size) {
    pendingFiles.push({
        name: name,
        content: dataUrl,
        size: size,
        isImage: true,
        type: 'image/png'
    });
}

// ★ 在光标位置插入文字(支持拖拽文字)
function insertTextAtCursor(input, text) {
    if (!input || !text) return;
    var start = input.selectionStart || 0;
    var end = input.selectionEnd || 0;
    var before = input.value.substring(0, start);
    var after = input.value.substring(end);
    input.value = before + text + after;
    var newPos = start + text.length;
    input.setSelectionRange(newPos, newPos);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
}

async function processSelectedFiles(fileList) {
    for (const file of Array.from(fileList)) {
        if (file.size > MAX_FILE_SIZE) {
            showToast('文件 ' + file.name + ' 超过300MB', 'warning');
            continue;
        }

        // 检查是否是图片文件
        var isImage = file.type.startsWith('image/');
        var isVideo = file.type.startsWith('video/');

        // ★ 创建进度条容器(文件预览区域内)
        var progressContainer = document.createElement('div');
        progressContainer.className = 'file-upload-progress';
        progressContainer.style.cssText = 'display:flex;flex-direction:column;gap:2px;padding:4px 8px;margin:2px 0;';
        // 文件名行
        var nameRow = document.createElement('div');
        nameRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;font-size:11px;';
        var nameSpan = document.createElement('span');
        nameSpan.style.cssText = 'color:var(--text-secondary,#6b7280);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:70%;';
        nameSpan.textContent = file.name;
        var statusSpan = document.createElement('span');
        statusSpan.textContent = isImage ? '读取中...' : '解析中...';
        statusSpan.style.cssText = 'color:#3b82f6;font-weight:500;font-size:10px;';
        nameRow.appendChild(nameSpan);
        nameRow.appendChild(statusSpan);
        progressContainer.appendChild(nameRow);
        // 进度条
        var barWrap = document.createElement('div');
        barWrap.style.cssText = 'height:3px;background:#e5e7eb;border-radius:2px;overflow:hidden;';
        var bar = document.createElement('div');
        bar.style.cssText = 'height:100%;background:linear-gradient(90deg,#3b82f6,#8b5cf6);border-radius:2px;width:10%;transition:width 0.4s ease;';
        barWrap.appendChild(bar);
        progressContainer.appendChild(barWrap);
        // ★ 确保容器可见(移除 hidden 类,否则进度条加进去也看不见)
        if ($.filePreviewContainer) {
            $.filePreviewContainer.classList.remove('hidden');
            $.filePreviewContainer.appendChild(progressContainer);
        }

        function _setProgress(pct, label) {
            bar.style.width = pct + '%';
            statusSpan.textContent = label;
        }
        function _setError(label) {
            bar.style.background = 'linear-gradient(90deg,#ef4444,#f97316)';
            bar.style.width = '100%';
            statusSpan.textContent = label;
            statusSpan.style.color = '#ef4444';
        }
        function _setDone() {
            bar.style.width = '100%';
            bar.style.background = 'linear-gradient(90deg,#22c55e,#10b981)';
            statusSpan.textContent = '✅ 完成';
            statusSpan.style.color = '#22c55e';
        }

        try {
            if (isImage) {
                _setProgress(5, '读取中...');
                var base64 = await fileToBase64(file);
                var rawDataUrl = 'data:' + file.type + ';base64,' + base64;

                // ★ 客户端压缩图片
                _setProgress(20, '压缩中...');
                var compressedUrl;
                try {
                    compressedUrl = await compressImage(rawDataUrl);
                } catch(e) {
                    console.warn('[compressImage] 压缩失败,使用原始图片:', e.message);
                    compressedUrl = rawDataUrl;
                }
                var dataUrl = compressedUrl || rawDataUrl;
                var compressedBytes = atob(dataUrl.split(',')[1] || '').length;
                var compressedSizeKB = Math.round(compressedBytes / 1024);
                console.log('[Image]', file.name, '压缩:', (file.size/1024).toFixed(0), 'KB →', compressedSizeKB, 'KB');

                // ★ 上传到本地服务器(用压缩后的字节数,UI显示正确的实际大小)
                // type 从压缩后 dataUrl 提取,保持原始格式(JPEG/PNG),避免 webp 不被本地模型支持
                var _compType = (dataUrl.match(/^data:(image\/[\w+]+);/) || [])[1] || 'image/jpeg';
                var fileObj = { name: file.name, content: dataUrl, size: compressedBytes, isImage: true, type: _compType };
                _setProgress(60, '上传中...');
                try {
                    var srvUrl = await uploadImageToServer(dataUrl);
                    if (srvUrl) {
                        fileObj.serverUrl = srvUrl;
                        _setProgress(95, '上传完成');
                    } else {
                        _setProgress(95, '上传失败(用缓存)');
                    }
                } catch(e) {
                    console.warn('[upload] 上传失败:', e.message);
                    _setProgress(95, '上传异常(用缓存)');
                }
                pendingFiles.push(fileObj);
                _setDone();
                // 短暂展示完成状态后替换为文件tag
                setTimeout(function() {
                    if (progressContainer.parentNode) progressContainer.remove();
                    updateFilePreviewUI();
                }, 600);
            } else if (isVideo) {
                _setProgress(5, '准备上传...');
                // ★ 直接 Blob 上传: 避免 FileReader.readAsDataURL 将大视频全部读入内存
                //    30MB+ 视频用 base64 会导致浏览器内存溢出崩溃
                var fileObj = { name: file.name, isVideo: true, type: file.type, size: file.size };
                _setProgress(30, '上传视频中...');
                try {
                    var srvUrl = await uploadVideoBlob(file, _setProgress);
                    if (srvUrl) {
                        fileObj.serverUrl = srvUrl;
                        fileObj.content = srvUrl; // 存 URL 而非 base64,节省内存
                        _setProgress(95, '上传完成');
                    } else {
                        // 降级: 小视频走 base64
                        _setProgress(40, '降级读取...');
                        var base64 = await fileToBase64(file);
                        var dataUrl = 'data:' + file.type + ';base64,' + base64;
                        fileObj.content = dataUrl;
                        _setProgress(80, '上传(base64)...');
                        srvUrl = await uploadImageToServer(dataUrl);
                        if (srvUrl) fileObj.serverUrl = srvUrl;
                    }
                } catch(e) {
                    console.warn('[video] Blob上传失败,走base64:', e.message);
                    _setProgress(40, '降级读取...');
                    var base64 = await fileToBase64(file);
                    var dataUrl = 'data:' + file.type + ';base64,' + base64;
                    fileObj.content = dataUrl;
                    _setProgress(80, '上传(base64)...');
                    srvUrl = await uploadImageToServer(dataUrl);
                    if (srvUrl) fileObj.serverUrl = srvUrl;
                }
                pendingFiles.push(fileObj);
                _setDone();
                setTimeout(function() {
                    if (progressContainer.parentNode) progressContainer.remove();
                    updateFilePreviewUI();
                }, 600);
            } else {
                _setProgress(20, '解析中...');
                var _extractResult = await extractFileContent(file);
                // ★ 支持 office 文档返回 {text, images, isOfficeDoc} 对象
                if (_extractResult && typeof _extractResult === 'object' && _extractResult.isOfficeDoc) {
                    var _fileObj = { name: file.name, content: _extractResult.text || '', size: file.size, isImage: false, type: file.type };
                    if (_extractResult.images && _extractResult.images.length > 0) {
                        _fileObj.extractedImages = _extractResult.images;
                        _fileObj.hasEmbeddedImages = true;
                        _setProgress(90, '提取到' + _extractResult.images.length + '张图');
                    }
                    pendingFiles.push(_fileObj);
                } else {
                    var content = typeof _extractResult === 'string' ? _extractResult : (_extractResult ? String(_extractResult) : '');
                    pendingFiles.push({ name: file.name, content: content, size: file.size, isImage: false, type: file.type });
                }
                _setDone();
                setTimeout(function() {
                    if (progressContainer.parentNode) progressContainer.remove();
                    updateFilePreviewUI();
                }, 400);
            }
        } catch (err) {
            console.warn('[processFile] 出错:', err.message);
            _setError('失败: ' + err.message);
            setTimeout(function() {
                if (progressContainer.parentNode) progressContainer.remove();
                updateFilePreviewUI();
            }, 2000);
        }
    }
    updateFilePreviewUI();
    if ($.fileInput) $.fileInput.value = '';
}

// 文件转为 base64
function fileToBase64(file) {
    return new Promise(function(resolve, reject) {
        var reader = new FileReader();
        reader.onload = function() { resolve(reader.result.split(',')[1]); };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}
