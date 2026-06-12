// ==UserScript==
// @name         OpenList 智能刮削整理工具 (基于 TMDB)
// @namespace    https://github.com/
// @version      4.5
// @description  利用 TMDB 智能解析 OpenList 中的影视资源，自动刮削并规范目录结构（完美支持剧名提取、集数识别、去重跳过等）
// @author       Your Name
// @license      MIT
// @include      *://*oplist*/*
// @include      *://*openlist*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      api.themoviedb.org
// ==/UserScript==

(function() {
    'use strict';

    // === OpenList / AList 站点自动检测机制 ===
    function isAList() {
        // OpenList 底层其实就是 AList，这里用它特有的 token 和元素进行隐式判断
        if (localStorage.getItem('alist_token')) return true;
        if (document.querySelector('meta[name="description"][content*="alist" i]')) return true;
        if (document.title.toLowerCase().includes('alist') || document.title.toLowerCase().includes('openlist')) return true;
        return false;
    }

    if (!isAList()) {
        return; 
    }

    const baseUrl = window.location.origin;

    // ================= 1. UI 界面注入 =================
    function injectUI() {
        if (document.getElementById('alist-copy-panel')) return;

        const datalistContainer = document.createElement('div');
        datalistContainer.innerHTML = `
            <datalist id="ac-src-list">
                <option value="/阿里/来自分享/视频/动漫">
                <option value="/阿里/来自分享/视频/videos">
                <option value="/阿里/来自分享/视频/综艺">
                <option value="/阿里/来自分享/视频/电视剧">
            </datalist>
            <datalist id="ac-dst-list">
                <option value="/115pan/影视/videos">
                <option value="/115pan/影视/动漫">
                <option value="/115pan/影视/综艺">
                <option value="/115pan/影视/电视剧">
            </datalist>
        `;
        document.body.appendChild(datalistContainer);

        const panel = document.createElement('div');
        panel.id = 'alist-copy-panel';
        panel.style.cssText = `
            position: fixed; top: 100px; right: 20px; width: 340px;
            background: #ffffff; border: 1px solid #ccc; border-radius: 8px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.2); z-index: 2147483647;
            font-family: sans-serif; padding: 15px; box-sizing: border-box;
        `;

        const defaultSrc = localStorage.getItem('ac_src') || '/阿里/来自分享/视频/动漫';
        const defaultDst = localStorage.getItem('ac_dst') || '/115pan/影视/动漫';
        const defaultTmdbKey = localStorage.getItem('ac_tmdb_key') || '';
        const defaultTmdbEnable = localStorage.getItem('ac_tmdb_enable') === 'true' ? 'checked' : '';

        panel.innerHTML = `
            <div id="ac-drag-handle" style="margin: -15px -15px 10px -15px; padding: 12px 15px; background: #f8f9fa; border-radius: 8px 8px 0 0; border-bottom: 1px solid #eee; cursor: move; user-select: none; display: flex; justify-content: space-between; align-items: center;">
                <h3 style="margin: 0; font-size: 15px; color: #333;">🚀 OpenList 智能刮削助手 V4.2</h3>
                <span id="ac-close-btn" style="font-size: 14px; color: #999; cursor: pointer;">✖隐藏</span>
            </div>
            <div style="margin-bottom: 8px;">
                <label style="font-size: 12px; color: #666;">源文件夹 (双击展开):</label>
                <input id="ac-src" type="text" list="ac-src-list" style="width: 100%; padding: 6px; box-sizing: border-box; border: 1px solid #ddd; border-radius: 4px;" value="${defaultSrc}">
            </div>
            <div style="margin-bottom: 8px;">
                <label style="font-size: 12px; color: #666;">目标基础文件夹 (双击展开):</label>
                <input id="ac-dst" type="text" list="ac-dst-list" style="width: 100%; padding: 6px; box-sizing: border-box; border: 1px solid #ddd; border-radius: 4px;" value="${defaultDst}">
            </div>
            <div style="margin-bottom: 12px; border-top: 1px solid #eee; padding-top: 8px;">
                <label style="font-size: 12px; color: #666; display: flex; align-items: center; gap: 5px; cursor: pointer; margin-bottom: 5px;">
                    <input type="checkbox" id="ac-tmdb-enable" ${defaultTmdbEnable}> 启用 TMDB 智能刮削整理 (MoviePilot模式)
                </label>
                <div id="ac-tmdb-config" style="display: ${defaultTmdbEnable ? 'block' : 'none'};">
                    <input id="ac-tmdb-key" type="text" placeholder="请输入 TMDB API Key" style="width: 100%; padding: 6px; box-sizing: border-box; border: 1px solid #ddd; border-radius: 4px; font-size: 12px;" value="${defaultTmdbKey}">
                </div>
            </div>
            <button id="ac-start-btn" style="width: 100%; padding: 10px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 14px;">开始深度同步</button>
            <div id="ac-log" style="margin-top: 10px; font-size: 12px; color: #444; background: #f9f9f9; padding: 8px; border-radius: 4px; height: 160px; overflow-y: auto; word-break: break-all; border: 1px solid #eee;">
                等待指令...
            </div>
        `;
        document.body.appendChild(panel);

        // 绑定 TMDB 开关事件
        setTimeout(() => {
            const tmdbCb = document.getElementById('ac-tmdb-enable');
            if(tmdbCb) {
                tmdbCb.addEventListener('change', e => {
                    document.getElementById('ac-tmdb-config').style.display = e.target.checked ? 'block' : 'none';
                });
            }
        }, 100);

        const handle = document.getElementById('ac-drag-handle');
        let isDragging = false, offsetX, offsetY;

        handle.addEventListener('mousedown', function(e) {
            if(e.target.id === 'ac-close-btn') return;
            isDragging = true;
            const rect = panel.getBoundingClientRect();
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;
        });

        document.addEventListener('mousemove', function(e) {
            if (!isDragging) return;
            panel.style.left = `${e.clientX - offsetX}px`;
            panel.style.top = `${e.clientY - offsetY}px`;
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
        });

        document.addEventListener('mouseup', () => isDragging = false);
        document.getElementById('ac-close-btn').addEventListener('click', () => panel.style.display = 'none');
        document.getElementById('ac-start-btn').addEventListener('click', startProcess);
    }

    function log(msg) {
        const logDiv = document.getElementById('ac-log');
        if(!logDiv) return;
        const time = new Date().toLocaleTimeString();
        logDiv.innerHTML += `<div>[${time}] ${msg}</div>`;
        logDiv.scrollTop = logDiv.scrollHeight;
    }

    // ================= 2. 核心 API 逻辑 =================
    async function apiRequest(endpoint, payload, token = null) {
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = token;
        const res = await fetch(`${baseUrl}${endpoint}`, { method: 'POST', headers, body: JSON.stringify(payload) });
        return await res.json();
    }

    // 路径拼接小工具，防止出现 "//" 导致报错
    function pathJoin(a, b) {
        return (a.endsWith('/') ? a : a + '/') + b;
    }

    // 确保顶级目标目录存在 (原有的 115 拦截逻辑)
    async function ensureDirRecursive(targetPath, token) {
        const parts = targetPath.split('/').filter(p => p.trim() !== '');
        let currentPath = '';

        for (let i = 0; i < parts.length; i++) {
            const parentPath = currentPath || '/';
            currentPath += '/' + parts[i];

            let checkRes = await apiRequest('/api/fs/list', { path: currentPath, password: "", refresh: true }, token);

            if (checkRes.code !== 200) {
                log(`[${currentPath}] 不存在，创建中...`);
                const mkdirData = await apiRequest('/api/fs/mkdir', { path: currentPath }, token);

                if (mkdirData.code !== 200) {
                    if (mkdirData.message && mkdirData.message.includes('cannot unmarshal array')) {
                        alert(`⚠️ 触发 OpenList 官方 115 驱动 Bug！\n\n请手动在115建立：\n【 ${currentPath} 】\n建好后重新点击同步！`);
                        throw new Error(`底层Bug中断，等待人工建档。`);
                    }
                    throw new Error(`创建失败 [${currentPath}]: ${mkdirData.message}`);
                }
                await new Promise(r => setTimeout(r, 1500));
                await apiRequest('/api/fs/list', { path: parentPath, password: "", refresh: true }, token);
            }
        }
    }

    function getLocalToken() {
        let token = localStorage.getItem('token');
        if (!token) return null;
        return token.replace(/^"|"$/g, '');
    }

    // ================= 3. TMDB 智能刮削模块 =================
    const tmdbCache = new Map();

    function parseMediaName(str) {
        let title = str.replace(/\.[a-z0-9]+$/i, ''); // 移除后缀
        let season = 1;
        let tmdbId = null;
        let isFallback = false;
        let isTv = false;
        
        // 提取精确 tmdb id
        let idMatch = title.match(/\{tmdb-(\d+)\}/i) || title.match(/\[tmdb-(\d+)\]/i);
        if (idMatch) {
            tmdbId = idMatch[1];
        }
        
        // 彻底清除常见的媒体库识别标签
        title = title.replace(/[\{\[][a-z]+-(tt)?\d+[\}\]]/ig, ' ');
        
        let sMatch = title.match(/S(\d{1,2})/i) || title.match(/Season\s*(\d{1,2})/i) || title.match(/第(\d{1,2})季/);
        if (sMatch) {
            season = parseInt(sMatch[1]);
            title = title.replace(sMatch[0], ' ');
            isTv = true;
        }
        
        // 提取集数
        let episode = null;
        let epMatch1 = title.match(/[\[\(]?(?:E|EP)(\d{1,4})[\]\)]?/i);
        let epMatch2 = title.match(/第(\d{1,4})[集话]/);
        let epMatch3 = title.match(/-\s*(\d{1,4})(?!\d)/);
        let epMatch4 = title.match(/\[(\d{1,4})(?:v\d)?\]/i); // 匹配 [01] 这种日漫集数
        
        if (epMatch1) episode = parseInt(epMatch1[1]);
        else if (epMatch2) episode = parseInt(epMatch2[1]);
        else if (epMatch3) episode = parseInt(epMatch3[1]);
        else if (epMatch4 && parseInt(epMatch4[1]) < 1000) episode = parseInt(epMatch4[1]);
        
        if (episode !== null) {
            isTv = true;
        }
        
        // 清理集数和特定标记
        title = title.replace(/[\[\(]?(E|EP)\d{1,4}[\]\)]?/ig, ' ')
                     .replace(/第\d{1,4}[集话]/g, ' ')
                     .replace(/-\s*\d{1,4}(?!\d)/g, ' '); 

        // 清理年份
        title = title.replace(/[\(\[]?(19\d{2}|20\d{2})[\)\]]?/g, ' ');

        // 移除常见分辨率和格式标签
        title = title.replace(/[\(\[]?(1080p|720p|2160p|4k|8k|x264|x265|h264|h265|hevc|avc|aac|flac|web-dl|webrip|bluray|bdrip|hdtv|web|dl|ddp|hdr10)[\)\]]?/ig, ' ');

        // 特殊处理：如果是 [字幕组][标题][集数] 尝试直接抓第二项
        const brackets = [...title.matchAll(/\[(.*?)\]/g)].map(m => m[1]);
        if (brackets.length >= 2 && brackets[1].length > 1) {
            title = brackets[1];
        } else {
            title = title.replace(/^\[.*?\]/, ' ').replace(/^【.*?】/, ' ');
            title = title.replace(/【.*?】/g, ' ');
            let temp = title.replace(/\[.*?\]/g, ' ').replace(/\(.*?\)/g, ' ');
            if (temp.trim().length > 1) title = temp;
        }
        
        title = title.replace(/[._\-★]/g, ' ').replace(/\s+/g, ' ').trim();
        
        // 如果全被清理空了（说明全都是诸如集数、分辨率等杂质），触发回退机制
        if (!title) {
            title = str.replace(/\.[^/.]+$/, "");
            isFallback = true;
        }
        
        return { title, season, episode, tmdbId, isFallback, isTv };
    }

    async function fetchTMDBInfo(title, apiKey, tmdbId = null, isTv = false) {
        if (!apiKey) return null;
        let cacheKey = tmdbId ? `id_${tmdbId}_${isTv ? 'tv' : 'movie'}` : title;
        if (!cacheKey) return null;
        
        if (tmdbCache.has(cacheKey)) return tmdbCache.get(cacheKey);
        
        try {
            if (tmdbId) {
                if (isTv) {
                    // 如果明确是剧集，先请求 TV 接口
                    let tRes = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${apiKey}&language=zh-CN`);
                    if (tRes.status === 200) {
                        let item = await tRes.json();
                        let result = { name: item.name || item.original_name, year: item.first_air_date ? item.first_air_date.substring(0,4) : "", type: 'tv' };
                        tmdbCache.set(cacheKey, result);
                        return result;
                    }
                    let mRes = await fetch(`https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${apiKey}&language=zh-CN`);
                    if (mRes.status === 200) {
                        let item = await mRes.json();
                        let result = { name: item.title || item.original_title, year: item.release_date ? item.release_date.substring(0,4) : "", type: 'movie' };
                        tmdbCache.set(cacheKey, result);
                        return result;
                    }
                } else {
                    // 默认先尝试电影接口
                    let mRes = await fetch(`https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${apiKey}&language=zh-CN`);
                    if (mRes.status === 200) {
                        let item = await mRes.json();
                        let result = { name: item.title || item.original_title, year: item.release_date ? item.release_date.substring(0,4) : "", type: 'movie' };
                        tmdbCache.set(cacheKey, result);
                        return result;
                    }
                    let tRes = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${apiKey}&language=zh-CN`);
                    if (tRes.status === 200) {
                        let item = await tRes.json();
                        let result = { name: item.name || item.original_name, year: item.first_air_date ? item.first_air_date.substring(0,4) : "", type: 'tv' };
                        tmdbCache.set(cacheKey, result);
                        return result;
                    }
                }
            }

            if (!title) return null;

            const url = `https://api.themoviedb.org/3/search/multi?api_key=${apiKey}&query=${encodeURIComponent(title)}&language=zh-CN`;
            const res = await fetch(url);
            const data = await res.json();
            if (data.results && data.results.length > 0) {
                const item = data.results.find(r => r.media_type === 'tv' || r.media_type === 'movie') || data.results[0];
                const name = item.title || item.name || item.original_name || item.original_title || title;
                const date = item.release_date || item.first_air_date || "";
                const year = date ? date.substring(0, 4) : "";
                const result = { name, year, type: item.media_type || 'tv' };
                tmdbCache.set(cacheKey, result);
                return result;
            }
        } catch (e) {
            console.error("TMDB error:", e);
        }
        tmdbCache.set(cacheKey, null);
        return null;
    }

    // ★★★ V4.0 TMDB 智能刮削引擎 ★★★
    async function getTmdbSyncTasks(srcPath, baseDstPath, token, apiKey) {
        let tasksMap = {}; 

        async function traverse(currentSrc) {
            log(`🔎 智能分析目录: ${currentSrc}`);
            const srcListRes = await apiRequest('/api/fs/list', { path: currentSrc, password: "", refresh: true }, token);
            if (srcListRes.code !== 200 || !srcListRes.data.content) return;

            // 获取层级路径名，用于向上寻根（反转数组让最近的文件夹排前面）
            const pathParts = currentSrc.split('/').filter(p => p.trim() !== '');
            const folderNames = pathParts.reverse();

            for (const item of srcListRes.data.content) {
                const name = item.name;
                if (item.is_dir) {
                    await traverse(pathJoin(currentSrc, name));
                } else {
                    if (!/\.(mp4|mkv|avi|rmvb|ts|flv|srt|ass)$/i.test(name)) continue;

                    let parsedFile = parseMediaName(name);
                    
                    // 向上寻找有效的剧名文件夹
                    // 彻底拉黑各类通用无意义的文件夹名
                    const invalidFolderRegex = /^(season\s*\d*|第\d+季|downloads?|video|视频|动漫|电影|电视剧|share|共享|movies|tv|series|documentary)$/i;
                    let parsedFolder = {title: "", season: 1, tmdbId: null, isFallback: true};
                    let foundValidFolder = false;
                    
                    for (const fName of folderNames) {
                        let tempParsed = parseMediaName(fName);
                        if (tempParsed.title && tempParsed.title.length > 1 && !invalidFolderRegex.test(tempParsed.title)) {
                            parsedFolder = tempParsed;
                            foundValidFolder = true;
                            break; 
                        }
                    }

                    // 最近的直接父文件夹（不论名字是否有效），用来保底提取季数和 ID
                    let directParentParsed = folderNames.length > 0 ? parseMediaName(folderNames[0]) : null;

                    // 汇总季数 (优先级递增)
                    let targetSeason = 1;
                    if (parsedFolder && parsedFolder.season > 1) targetSeason = parsedFolder.season;
                    if (directParentParsed && directParentParsed.season > 1) targetSeason = directParentParsed.season;
                    if (parsedFile.season > 1) targetSeason = parsedFile.season;

                    let targetIsTv = false;
                    if (parsedFile.isTv || parsedFolder.isTv || (directParentParsed && directParentParsed.isTv) || targetSeason > 1) {
                        targetIsTv = true;
                    }

                    // 汇总 TMDB ID (优先级递减)
                    let targetTmdbId = parsedFile.tmdbId;
                    if (!targetTmdbId && directParentParsed) targetTmdbId = directParentParsed.tmdbId;
                    if (!targetTmdbId && foundValidFolder) targetTmdbId = parsedFolder.tmdbId;

                    let targetTitle = parsedFile.title;
                    
                    if (foundValidFolder) {
                        let hasChinese = (s) => /[\u4e00-\u9fa5]/.test(s);
                        let fileHasChs = hasChinese(targetTitle);
                        let folderHasChs = hasChinese(parsedFolder.title);
                        let fileRatio = targetTitle.length / name.length;
                        
                        let useFolder = false;
                        // 多维度智能判断：如果文件名提取的标题质量差，强烈偏向使用文件夹名
                        if (parsedFile.isFallback) useFolder = true; 
                        else if (targetTitle.length < 3) useFolder = true; 
                        else if (folderHasChs && !fileHasChs) useFolder = true; 
                        else if (parsedFolder.title.length > targetTitle.length + 3) useFolder = true; 
                        else if (fileRatio < 0.4) useFolder = true; 
                        
                        if (useFolder) {
                            targetTitle = parsedFolder.title;
                        }
                    }

                    let finalDstDir = baseDstPath;

                    if (targetTitle || targetTmdbId) {
                        let tmdb = await fetchTMDBInfo(targetTitle, apiKey, targetTmdbId, targetIsTv);
                        
                        // 容错：没提供 ID 时如果搜不到，尝试切回文件名再搜
                        if ((!tmdb || !tmdb.name) && !targetTmdbId && targetTitle !== parsedFile.title && parsedFile.title.length > 2) {
                            tmdb = await fetchTMDBInfo(parsedFile.title, apiKey, null, targetIsTv);
                        }

                        if (tmdb && tmdb.name) {
                            const yearStr = tmdb.year ? ` (${tmdb.year})` : '';
                            finalDstDir = pathJoin(baseDstPath, `${tmdb.name}${yearStr}`);
                            if (tmdb.type === 'tv' || targetSeason > 0) {
                                finalDstDir = pathJoin(finalDstDir, `Season ${targetSeason}`);
                            }
                            log(`🎬 识别: [${folderNames[0] ? folderNames[0]+'/' : ''}${name}] => ${tmdb.name}${yearStr} S${targetSeason}`);
                        } else {
                            finalDstDir = pathJoin(baseDstPath, `未识别_${targetTitle}`);
                        }
                    }

                    const taskKey = `${currentSrc}|${finalDstDir}`;
                    if (!tasksMap[taskKey]) tasksMap[taskKey] = { src_dir: currentSrc, dst_dir: finalDstDir, names: [] };
                    tasksMap[taskKey].names.push(name);
                }
            }
        }

        await traverse(srcPath);
        
        let finalTasks = [];
        for (const task of Object.values(tasksMap)) {
            const dstListRes = await apiRequest('/api/fs/list', { path: task.dst_dir, password: "", refresh: true }, token);
            let dstExistNames = [];
            if (dstListRes.code === 200 && dstListRes.data && dstListRes.data.content) {
                dstExistNames = dstListRes.data.content.map(f => f.name);
            }
            
            // 提取目标目录已存在文件的集数
            let dstExistEpisodes = [];
            for (const dName of dstExistNames) {
                 let dParsed = parseMediaName(dName);
                 if (dParsed.episode !== null) dstExistEpisodes.push(dParsed.episode);
            }
            
            let namesToCopy = task.names.filter(n => {
                if (dstExistNames.includes(n)) return false;
                
                // 集数重合过滤机制
                let srcParsed = parseMediaName(n);
                if (srcParsed.episode !== null && dstExistEpisodes.includes(srcParsed.episode)) {
                    log(`ℹ️ [去重] 跳过 ${n}，目标目录已存在第 ${srcParsed.episode} 集`);
                    return false;
                }
                
                return true;
            });

            if (namesToCopy.length > 0) {
                await ensureDirRecursive(task.dst_dir, token);
                finalTasks.push({ src_dir: task.src_dir, dst_dir: task.dst_dir, names: namesToCopy });
            }
        }
        return finalTasks;
    }

    // ★★★ V3.0 核心：深度递归扫描比对引擎 ★★★
    async function getDeepSyncTasks(srcPath, dstPath, token) {
        let copyTasks = []; // 存放所有需要提交的复制任务集合

        async function traverse(currentSrc, currentDst) {
            log(`🔎 深度扫描目录: ${currentSrc}`);
            const srcListRes = await apiRequest('/api/fs/list', { path: currentSrc, password: "", refresh: true }, token);
            if (srcListRes.code !== 200 || !srcListRes.data.content) return;
            const srcItems = srcListRes.data.content;

            let dstExistNames = [];
            const dstListRes = await apiRequest('/api/fs/list', { path: currentDst, password: "", refresh: true }, token);
            if (dstListRes.code === 200 && dstListRes.data && dstListRes.data.content) {
                dstExistNames = dstListRes.data.content.map(f => f.name);
            }

            let namesToCopyNow = []; // 当前层级需要转移的项（可能是文件，也可能是全新的文件夹）

            for (const item of srcItems) {
                const name = item.name;
                const isDir = item.is_dir;

                if (!dstExistNames.includes(name)) {
                    // 情况1：目标网盘里压根没有这个东西（无论文件还是文件夹）
                    // 直接把它加入复制列表，AList 会自动打包复制整个文件夹
                    namesToCopyNow.push(name);
                } else {
                    // 情况2：目标网盘里【已经存在】这个同名项目！
                    if (isDir) {
                        // 如果是文件夹，并且已经存在，我们【必须】钻进去继续比对！
                        await traverse(pathJoin(currentSrc, name), pathJoin(currentDst, name));
                    } else {
                        // 如果是文件，并且已经存在，直接跳过 (同名文件忽略)
                        // log(`[跳过] 同名文件: ${name}`);
                    }
                }
            }

            // 当前层级扫描完毕，如果有需要转移的东西，打包成一个任务
            if (namesToCopyNow.length > 0) {
                log(`📦 目录 [${currentSrc}] 找到 ${namesToCopyNow.length} 个新增项。`);
                copyTasks.push({ src_dir: currentSrc, dst_dir: currentDst, names: namesToCopyNow });
            }
        }

        await traverse(srcPath, dstPath);
        return copyTasks;
    }

    async function startProcess() {
        const srcDir = document.getElementById('ac-src').value.trim();
        const dstDir = document.getElementById('ac-dst').value.trim();

        if (!srcDir || !dstDir) return alert("源路径和目标路径不能为空！");
        if (srcDir.split('/').filter(p => p.trim() !== '').length < 2) return alert("❌ 源路径错误：必须包含挂载盘符！");
        if (dstDir.split('/').filter(p => p.trim() !== '').length < 2) return alert("❌ 目标路径错误：必须包含挂载盘符！");

        const tmdbCb = document.getElementById('ac-tmdb-enable');
        const tmdbEnable = tmdbCb ? tmdbCb.checked : false;
        const tmdbKeyInput = document.getElementById('ac-tmdb-key');
        const tmdbKey = tmdbKeyInput ? tmdbKeyInput.value.trim() : '';

        localStorage.setItem('ac_src', srcDir);
        localStorage.setItem('ac_dst', dstDir);
        localStorage.setItem('ac_tmdb_enable', tmdbEnable);
        localStorage.setItem('ac_tmdb_key', tmdbKey);

        if (tmdbEnable && !tmdbKey) {
            return alert("❌ 开启 TMDB 智能整理时，必须提供 TMDB API Key！");
        }

        const btn = document.getElementById('ac-start-btn');
        btn.disabled = true; btn.style.background = '#ccc';
        document.getElementById('ac-log').innerHTML = '';

        try {
            const token = getLocalToken();
            if (!token) throw new Error("无本地 Token，请先登录网页。");

            // 1. 确保最顶层的目标目录已经建好
            if (!tmdbEnable) await ensureDirRecursive(dstDir, token);

            // 2. 启动深度扫描引擎，获取所有零散的增量复制任务
            log(`--------------------------`);
            log(`🚀 开始执行全盘深度扫描，这可能需要一点时间...`);
            let tasks = [];
            if (tmdbEnable) {
                tasks = await getTmdbSyncTasks(srcDir, dstDir, token, tmdbKey);
            } else {
                tasks = await getDeepSyncTasks(srcDir, dstDir, token);
            }

            if (tasks.length === 0) {
                log(`--------------------------`);
                log("✅ 两端数据完全一致，没有发现任何新增的文件，任务结束。");
                btn.disabled = false; btn.style.background = '#007bff';
                return;
            }

            // 3. 将扫描出来的增量任务依次发送给后台执行
            log(`--------------------------`);
            log(`🔥 扫描完毕！共生成 ${tasks.length} 个目录的同步任务，开始提交...`);

            for (let i = 0; i < tasks.length; i++) {
                const task = tasks[i];
                log(`[${i+1}/${tasks.length}] 正在提交: ${task.src_dir} ...`);
                const copyRes = await apiRequest('/api/fs/copy', task, token);
                if (copyRes.code !== 200) {
                    throw new Error(`部分提交失败: ${copyRes.message}`);
                }
            }

            log(`🎉 所有任务提交成功！<a href="${baseUrl}/@manage/tasks/copy" target="_blank" style="color: #007bff; text-decoration: underline; font-weight: bold;">👉点击去后台查看转移进度</a>`);

        } catch (error) {
            log(`❌ ${error.message}`);
        } finally {
            btn.disabled = false; btn.style.background = '#007bff';
        }
    }

    const injectInterval = setInterval(() => {
        if (document.body && !document.getElementById('alist-copy-panel')) {
            injectUI();
            clearInterval(injectInterval);
        }
    }, 1000);

})();