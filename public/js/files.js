// files.js — 文件处理 v1.0 (Phase 6)
// 文件读写/预览/上传/粘贴/拖拽

// ==================== 工具函数 ====================
// ★ 检测 ArrayBuffer 是否为有效 ZIP 文件（PK 魔数头）
function _isZipBuffer(ab) {
    if (!ab || ab.byteLength < 4) return false;
    var _dv = new DataView(ab);
    // ZIP 文件以 PK\x03\x04 或 PK\x05\x06 (空ZIP) 开头
    return _dv.getUint8(0) === 0x50 && _dv.getUint8(1) === 0x4B &&
           (_dv.getUint8(2) === 0x03 || _dv.getUint8(2) === 0x05);
}

// ★ 提取旧版 .doc (OLE2 二进制格式) 中的文本
//   原理: .doc 文件以 UTF-16LE 存储文本, 夹杂二进制格式控制符
//   策略: 逐双字节解码, 提取连续可打印字符序列
function _extractDocText(ab) {
    if (!ab || ab.byteLength < 100) return '';
    var _u8 = new Uint8Array(ab);
    var _len = _u8.length;
    var _result = [];
    var _current = '';

    // ★ 方法1: 逐双字节 UTF-16LE 解码, 提取可打印字符
    for (var _i = 0; _i + 1 < _len; _i += 2) {
        var _lo = _u8[_i];
        var _hi = _u8[_i + 1];
        var _code = _lo | (_hi << 8);

        // 高字节为 0 → 基本 ASCII/Latin (UTF-16LE)
        if (_hi === 0) {
            if (_code >= 0x20 && _code < 0x7F) {
                // 可打印 ASCII
                _current += String.fromCharCode(_code);
            } else if (_code === 0x0A || _code === 0x0D || _code === 0x09) {
                // 换行/回车/制表
                if (_current.trim()) _result.push(_current.trim());
                _current = '';
            } else if (_code < 0x20 && _code !== 0x09) {
                // 控制字符 → 截断
                if (_current.trim()) _result.push(_current.trim());
                _current = '';
            } else {
                // 其他 (0x80-0xFF 扩展 ASCII)
                _current += String.fromCharCode(_code);
            }
        } else if (_code >= 0x4E00 && _code <= 0x9FFF) {
            // ★ 中文字符 (CJK 统一表意文字)
            _current += String.fromCharCode(_code);
        } else if (_code >= 0x3000 && _code <= 0x303F) {
            // 中文标点
            _current += String.fromCharCode(_code);
        } else if (_code >= 0xFF00 && _code <= 0xFFEF) {
            // 全角字符
            _current += String.fromCharCode(_code);
        } else if (_hi >= 0x20 && _hi <= 0x7E) {
            // 其他双字节: 高字节可打印 → 可能是乱码, 跳过
            if (_current.trim()) _result.push(_current.trim());
            _current = '';
        } else {
            // 二进制控制数据 → 截断
            if (_current.trim()) _result.push(_current.trim());
            _current = '';
        }
    }
    if (_current.trim()) _result.push(_current.trim());

    // ★ 方法2: 方法1结果太少时, 尝试用 TextDecoder UTF-16LE 全文解码
    if (_result.length < 5) {
        try {
            var _full = new TextDecoder('utf-16le', {fatal: false}).decode(ab);
            var _segments = _full.split(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]+/);
            _segments.forEach(function(_seg) {
                var _t = _seg.trim();
                if (_t.length > 1) _result.push(_t);
            });
        } catch(e) {}
    }

    // ★ 去重 + 过滤噪音
    var _seen = {};
    var _filtered = [];
    for (var _ri = 0; _ri < _result.length; _ri++) {
        var _t = _result[_ri].trim();
        if (_t.length < 2) continue;
        if (_seen[_t]) continue;
        // 过滤纯二进制乱码 (可打印率 < 70%)
        var _printable = 0;
        for (var _ci = 0; _ci < _t.length; _ci++) {
            var _cc = _t.charCodeAt(_ci);
            if (_cc >= 0x20 && _cc < 0x7F) _printable++;
            else if (_cc >= 0x4E00 && _cc <= 0x9FFF) _printable++;
            else if (_cc >= 0x3000 && _cc <= 0x303F) _printable++;
        }
        if (_printable / _t.length < 0.5) continue;
        _seen[_t] = true;
        _filtered.push(_t);
    }

    if (_filtered.length === 0) return '';
    return '[DOC 提取]\n\n' + _filtered.join('\n');
}

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
    // ★ 旧版 .doc (二进制 OLE2 格式) — 尽力提取文本
    if (ext === 'doc' || file.type === 'application/msword') {
        var _docAb = await file.arrayBuffer();
        var _docText = _extractDocText(_docAb);
        return _docText || '[DOC] 无法提取文本。建议用 Word/WPS 打开后另存为 .docx 重新上传以获得更好效果。';
    }
    if (ext === 'docx' || file.type.includes('word')) {
        var _ab = await file.arrayBuffer();
        var _docText = '';
        var _docImages = [];
        var _isDocxZip = _isZipBuffer(_ab);

        // ★ 1) 尝试 mammoth 提取文本
        if (window.mammoth) {
            try {
                var _result = await mammoth.extractRawText({ arrayBuffer: _ab });
                if (_result.value && _result.value.trim().length > 20) _docText = _result.value;
            } catch(e) {
                console.warn('[docx] mammoth 解析失败，降级为原始提取:', e.message);
            }
        }
        // ★ 2) mammoth 失败 → 用 JSZip 解压后提取 XML 文本（DOCX 本质是 ZIP）
        //    ★ 先检测是否为有效 ZIP, 不是则跳过 JSZip 避免无意义报错
        if (!_docText && window.JSZip && _isDocxZip) {
            try {
                var _docZip = await JSZip.loadAsync(_ab);
                var _docXmlFile = _docZip.files['word/document.xml'];
                if (_docXmlFile) {
                    var _docXml = await _docXmlFile.async('text');
                    var _wTexts = [];
                    var _wRe = /<w:t[^>]*>([^<]*)<\/w:t>/g; var _wM;
                    while ((_wM = _wRe.exec(_docXml)) !== null) {
                        if (_wM[1]) _wTexts.push(_wM[1]);
                    }
                    // ★ 段落之间用换行分隔，提升可读性
                    var _wParas = [];
                    var _pRe = /<w:p[ >]/g; var _wP;
                    var _lastPIdx = 0;
                    while ((_wP = _pRe.exec(_docXml)) !== null) {
                        if (_wP.index > _lastPIdx) {
                            var _seg = _docXml.substring(_lastPIdx, _wP.index);
                            var _segTexts = [];
                            var _sRe = /<w:t[^>]*>([^<]*)<\/w:t>/g; var _sM;
                            while ((_sM = _sRe.exec(_seg)) !== null) {
                                if (_sM[1]) _segTexts.push(_sM[1]);
                            }
                            if (_segTexts.length > 0) _wParas.push(_segTexts.join(''));
                        }
                        _lastPIdx = _wP.index;
                    }
                    if (_wTexts.length > 0) {
                        _docText = _wParas.length > 1 ? _wParas.join('\n') : _wTexts.join('');
                    }
                }
                if (!_docText || _docText.trim().length < 5) {
                    // ★ 检查 header/footer/footnotes/endnotes
                    var _extraParts = ['word/header1.xml','word/footer1.xml','word/footnotes.xml','word/endnotes.xml'];
                    var _extraTexts = [];
                    for (var _epi = 0; _epi < _extraParts.length; _epi++) {
                        var _epFile = _docZip.files[_extraParts[_epi]];
                        if (_epFile) {
                            try {
                                var _epXml = await _epFile.async('text');
                                var _epMatches = _epXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g);
                                if (_epMatches) {
                                    for (var _epj = 0; _epj < _epMatches.length; _epj++) {
                                        var _epT = _epMatches[_epj].replace(/<\/?w:t[^>]*>/g, '');
                                        if (_epT.trim()) _extraTexts.push(_epT.trim());
                                    }
                                }
                            } catch(e) {}
                        }
                    }
                    if (_extraTexts.length > 0) {
                        _docText = (_docText || '') + '\n[页眉页脚/脚注]\n' + _extraTexts.join(' ');
                    }
                }
            } catch(_jsZipErr) {
                console.warn('[docx] JSZip 解压失败，降级为原始提取:', _jsZipErr.message);
            }
        }
        // ★ 2b) JSZip 也失败/不可用 → 原始二进制中尽力提取（最后手段）
        if (!_docText) {
            var _raw = new TextDecoder('utf-8', {fatal: false}).decode(_ab);
            var _texts = [];
            var _re = /<w:t[^>]*>([^<]*)<\/w:t>/g; var _m;
            while ((_m = _re.exec(_raw)) !== null) {
                if (_m[1]) _texts.push(_m[1]);
            }
            if (_texts.length > 0) {
                _docText = _texts.join('');
            } else {
                var _plain = [];
                var _re2 = />([^<]{2,})</g; var _m2;
                while ((_m2 = _re2.exec(_raw)) !== null) {
                    var _t = _m2[1].replace(/&[a-z]+;/g, ' ').trim();
                    if (_t.length > 1) _plain.push(_t);
                }
                _docText = _plain.length > 0 ? '[DOCX] （无法完整解析，尽力提取碎片文本）\n\n' + _plain.slice(0, 200).join(' ') : '';
            }
        }

        // ★ 3) 提取内嵌图片（word/media/ 目录）
        if (window.JSZip && _isDocxZip) {
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
    if (ext === 'pdf' || file.type === 'application/pdf') {
        // ★ PDF: 通过 parse.php 后端提取（使用 pdftotext）
        try {
            var _token = localStorage.getItem('authToken') || '';
            var _formData = new FormData();
            _formData.append('file', file);
            var _resp = await fetch('/oneapichat/api/parse.php', {
                method: 'POST',
                body: _formData
            });
            if (_resp.ok) {
                var _data = await _resp.json();
                if (_data.success && _data.content && _data.content.trim()) {
                    return _data.content;
                }
                console.warn('[PDF] parse.php 返回失败:', _data.error || 'empty content');
                throw new Error(_data.error || 'PDF text extraction failed');
            }
            throw new Error('parse.php HTTP ' + _resp.status);
        } catch(_pdfErr) {
            console.warn('[PDF] 解析失败:', _pdfErr.message);
            // ★ 降级: 检测是否有效PDF,给出有意义提示
            var _pdfAb = await file.arrayBuffer();
            var _pdfHeader = new TextDecoder('utf-8', {fatal: false}).decode(_pdfAb.slice(0, 5));
            if (_pdfHeader.startsWith('%PDF')) {
                return '[PDF] 无法提取文字。此PDF可能是扫描图片或图片型PDF（无文字层），建议用OCR工具转换后再上传。';
            }
            return '[PDF] 文件解析失败: ' + _pdfErr.message + '。请尝试另存为新PDF后重新上传。';
        }
    }
    if (['xlsx', 'xls', 'xlsm'].includes(ext) || file.type.includes('spreadsheet')) {
        var _xlsxAb = await file.arrayBuffer();
        var _isXlsxZip = _isZipBuffer(_xlsxAb);
        // ★ 1) 优先用 SheetJS
        if (window.XLSX) {
            try {
                var wb = XLSX.read(_xlsxAb, { type: 'array' });
                return wb.SheetNames.map((name, i) => '【工作表 ' + (i + 1) + ': ' + name + '】\n' + XLSX.utils.sheet_to_csv(wb.Sheets[name], { FS: '\t', RS: '\n' })).join('\n\n');
            } catch(_xlsxErr) {
                console.warn('[xlsx] SheetJS 解析失败，降级为 JSZip:', _xlsxErr.message);
            }
        }
        // ★ 2) SheetJS 不可用/失败 → JSZip 直接解析 XML（仅有效ZIP才尝试）
        if (window.JSZip && _isXlsxZip) {
            try {
                var _xlsxZip = await JSZip.loadAsync(_xlsxAb);
                var _sharedStrings = [];
                if (_xlsxZip.files['xl/sharedStrings.xml']) {
                    var _ssXml = await _xlsxZip.files['xl/sharedStrings.xml'].async('text');
                    var _ssRe = /<si>[\s\S]*?<t[^>]*>([^<]*)<\/t>[\s\S]*?<\/si>/g; var _ssM;
                    while ((_ssM = _ssRe.exec(_ssXml)) !== null) {
                        _sharedStrings.push(_ssM[1] || '');
                    }
                }
                var _sheetFiles = Object.keys(_xlsxZip.files).filter(function(f) {
                    return /^xl\/worksheets\/sheet\d+\.xml$/i.test(f);
                }).sort();
                var _xlsxSheets = [];
                for (var _xsi = 0; _xsi < _sheetFiles.length; _xsi++) {
                    var _sXml = await _xlsxZip.files[_sheetFiles[_xsi]].async('text');
                    var _rows = [];
                    var _rowRe = /<row[ >][\s\S]*?<\/row>/g; var _rowM;
                    while ((_rowM = _rowRe.exec(_sXml)) !== null) {
                        var _cells = [];
                        var _cellRe = /<c[ >][\s\S]*?<\/c>/g; var _cellM;
                        while ((_cellM = _cellRe.exec(_rowM[0])) !== null) {
                            var _tMatch = _cellM[0].match(/t="([^"]*)"/);
                            var _vMatch = _cellM[0].match(/<v[^>]*>([^<]*)<\/v>/);
                            var _val = _vMatch ? _vMatch[1] : '';
                            if (_tMatch && _tMatch[1] === 's' && _sharedStrings.length > 0) {
                                var _ssIdx = parseInt(_val) || 0;
                                _val = _ssIdx < _sharedStrings.length ? _sharedStrings[_ssIdx] : _val;
                            }
                            _cells.push(_val);
                        }
                        if (_cells.some(function(c) { return c.trim(); })) {
                            _rows.push(_cells.join('\t'));
                        }
                    }
                    if (_rows.length > 0) {
                        _xlsxSheets.push('【工作表 ' + (_xsi + 1) + '】\n' + _rows.join('\n'));
                    }
                }
                if (_xlsxSheets.length > 0) return _xlsxSheets.join('\n\n');
            } catch(_jsZipXlsxErr) {
                console.warn('[xlsx] JSZip 解析失败:', _jsZipXlsxErr.message);
            }
        }
        throw new Error('无法解析 xlsx 文件，请刷新页面后重试');
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
    var _fileObj = {
        name: name,
        content: dataUrl,
        size: size,
        isImage: true,
        type: 'image/png',
        serverUrl: ''
    };
    pendingFiles.push(_fileObj);
    // ★ 立即上传到服务器, 确保刷新后图片不消失
    if (typeof uploadImageToServer === 'function') {
        uploadImageToServer(dataUrl, { name: name }).then(function(srvUrl) {
            if (srvUrl) {
                _fileObj.serverUrl = srvUrl;
                updateFilePreviewUI();
            }
        }).catch(function(e) {
            console.warn('[Paste] 图片上传服务器失败:', e.message);
        });
    }
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
        var _fileExt = (file.name.split('.').pop() || '').toLowerCase();
        var isHeic = (_fileExt === 'heic' || _fileExt === 'heif' || file.type === 'image/heic' || file.type === 'image/heif');
        var isImage = file.type.startsWith('image/') || isHeic;
        var isVideo = file.type.startsWith('video/');

        // ★ iPhone HEIC 检测提示 (服务器会自动转换为 JPEG)
        if (isHeic && !sessionStorage.getItem('_heicTipShown')) {
            showToast('📱 检测到 iPhone HEIC 图片, 上传后将自动转换为 JPEG 格式', 'info', 4000);
            sessionStorage.setItem('_heicTipShown', '1');
        }

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
                    var result = await uploadVideoBlob(file, _setProgress);
                    if (result && (result.url || result.path)) {
                        var _url = typeof result === 'string' ? result : (result.url || '');
                        fileObj.serverUrl = _url;
                        fileObj.serverPath = result.path || ''; // ★ 服务器真实路径, 模型可直接用
                        fileObj.content = _url; // 存 URL 而非 base64,节省内存
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
                // ★ v2.7.0: 判断是否为可解析的文本/文档, 否则作为通用文件上传到服务器
                var _ext = (file.name.split('.').pop() || '').toLowerCase();
                var _parseableExts = ['txt', 'md', 'js', 'py', 'json', 'html', 'css', 'xml', 'csv', 'log', 'sh', 'bat', 'conf', 'ini',
                    'docx', 'xlsx', 'xls', 'xlsm', 'pdf', 'doc', 'pptx', 'ppt', 'rtf', 'odt', 'epub'];
                var _isBinary = !_parseableExts.includes(_ext) && !file.type.startsWith('text/');

                if (_isBinary) {
                    // ★ 二进制文件(.msi/.exe/.zip/.apk等): 直接上传到服务器, 保留路径供Cloudreve/工具使用
                    _setProgress(10, '上传文件中...');
                    var _fileObj2 = { name: file.name, isVideo: false, isImage: false, type: file.type, size: file.size, isBinary: true };
                    try {
                        var _result2 = await uploadVideoBlob(file, _setProgress, true);
                        if (_result2 && (_result2.url || _result2.path)) {
                            _fileObj2.serverUrl = typeof _result2 === 'string' ? _result2 : (_result2.url || '');
                            _fileObj2.serverPath = _result2.path || '';
                            _fileObj2.content = _fileObj2.serverUrl;
                            _setProgress(95, '上传完成');
                        } else {
                            _setError('上传失败');
                        }
                    } catch(e) {
                        console.warn('[binary] 上传失败:', e.message);
                        _setError('上传失败');
                    }
                    pendingFiles.push(_fileObj2);
                    _setDone();
                    setTimeout(function() {
                        if (progressContainer.parentNode) progressContainer.remove();
                        updateFilePreviewUI();
                    }, 600);
                } else {
                    _setProgress(12, '上传并解析中...');
                    // 可解析文档也必须上传原文件。仅把解析文本传给模型会让模型知道内容，
                    // 却不知道可供 unzip/python-docx 等工具直接使用的真实路径，最终退化成全盘 find。
                    var _docUploadPromise = uploadVideoBlob(file, function(pct) {
                        _setProgress(Math.min(55, 12 + Math.round((pct - 30) * 0.45)), '上传原文件中...');
                    }, true).catch(function() { return null; });
                    var _extractResult = await extractFileContent(file);
                    var _docUpload = await _docUploadPromise;
                    var _serverUrl = _docUpload && (_docUpload.url || '') || '';
                    var _serverPath = _docUpload && (_docUpload.path || '') || '';
                    // ★ 支持 office 文档返回 {text, images, isOfficeDoc} 对象
                    if (_extractResult && typeof _extractResult === 'object' && _extractResult.isOfficeDoc) {
                        var _fileObj = { name: file.name, content: _extractResult.text || '', size: file.size, isImage: false, type: file.type, serverUrl: _serverUrl, serverPath: _serverPath };
                        if (_extractResult.images && _extractResult.images.length > 0) {
                            _fileObj.extractedImages = _extractResult.images;
                            _fileObj.hasEmbeddedImages = true;
                            _setProgress(90, '提取到' + _extractResult.images.length + '张图');
                        }
                        pendingFiles.push(_fileObj);
                    } else {
                        var content = typeof _extractResult === 'string' ? _extractResult : (_extractResult ? String(_extractResult) : '');
                        pendingFiles.push({ name: file.name, content: content, size: file.size, isImage: false, type: file.type, serverUrl: _serverUrl, serverPath: _serverPath });
                    }
                    _setDone();
                    setTimeout(function() {
                        if (progressContainer.parentNode) progressContainer.remove();
                        updateFilePreviewUI();
                    }, 400);
                }
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
