/**
 * 简体中文词典（I18N-01）。
 *
 * 类型标注为 `Dict`（即英文词典的形状），所以这里少一个键、多一个键或拼错
 * 一个键都会在 `tsc` 阶段报错——不会出现"中文界面里冒出半句英文"的情况。
 *
 * 翻译约定：
 *  - 术语沿用中文用户的习惯说法：阅读模式（preview）、资源管理器（explorer）、
 *    分栏（split）、禅模式（zen）、强调色（accent）。
 *  - 快捷键、路径、URL、产品名（Paperling、Tauri、Ollama、LM Studio、KaTeX…）
 *    保持原样。
 *  - 中英混排按中文排版习惯加空格，标点用全角；引用英文原文时用直角引号「」。
 *  - 含 <kbd>/<strong> 的句子按 `…Before / …Mid / …After` 拆分：中文语序与英文
 *    不同，不能照抄英文模板。
 */
import type { Dict } from "./en";

const zhCN: Dict = {
    common: {
        ok: "确定",
        cancel: "取消",
        close: "关闭",
        save: "保存",
        delete: "删除",
        rename: "重命名",
        retry: "重试",
        copy: "复制",
        copied: "已复制",
        loading: "加载中…",
        dismiss: "忽略",
    },

    dialog: {
        unsavedTitle: "未保存的修改",
        filesUnsaved: "有 {count} 个文件未保存",
        changesLost: "你的修改将丢失",
        saveThem: "这些文件有未保存的修改。关闭前要保存吗？",
        saveOneBefore: "要保存你对 ",
        saveOneAfter: " 所做的修改吗？",
        saveThemOne: "你有未保存的修改。关闭前要保存吗？",
        discardAll: "全部不保存",
        dontSave: "不保存",
        saveAll: "全部保存",
        saveNoteTitle: "保存笔记",
        saveNoteBody: "取个名字，并选择保存位置。",
        noteName: "笔记名称",
        willSaveAs: "将保存为“{name}”",
        notesFolder: "笔记文件夹：",
        downloadsHintBefore: "或者复制一份到本机的 ",
        downloads: "下载",
        downloadsHintAfter: " 文件夹，任何文件管理器都能看到。",
        saveToDownloads: "保存到下载",
        saveToNotes: "保存到笔记",
        updateTitle: "有可用更新",
        updateBodyBefore: "Paperling ",
        updateBodyMid: " 已就绪（当前版本 v",
        updateBodyEnd: "）。",
        whatsNew: "更新内容",
        installedRestarting: "已安装，正在重启…",
        downloadingPercent: "下载中… {percent}%",
        downloading: "下载中…",
        updateFailed: "更新失败：{message}",
        skipVersion: "跳过此版本",
        later: "稍后",
        updateNow: "立即更新",
        errorTitle: "出了点问题",
        errorBody: "Paperling 遇到了意外错误。你的文件数据应该是安全的。",
        tryAgain: "重试",
        welcomeTour: "新手引导",
    },

    tableToolbar: {
        ariaLabel: "表格编辑",
        row: "行",
        col: "列",
        rowAbove: "在上方插入行",
        rowBelow: "在下方插入行",
        rowDelete: "删除行",
        colLeft: "在左侧插入列",
        colRight: "在右侧插入列",
        colDelete: "删除列",
        alignLeft: "列左对齐",
        alignCenter: "列居中",
        alignRight: "列右对齐",
        tidy: "整理表格（对齐各列）",
    },

    statusBar: {
        bar: "状态栏",
        filesTitle: "文件（Ctrl+Shift+E）",
        openExplorer: "打开文件面板",
        closeExplorer: "关闭文件面板",
        tocTitle: "大纲（Ctrl+Shift+O）",
        openToc: "打开大纲",
        closeToc: "关闭大纲",
        backlinksTitle: "反向链接",
        openBacklinks: "打开反向链接",
        closeBacklinks: "关闭反向链接",
        fileSaved: "文件已保存",
        fileUnsaved: "文件有未保存的修改",
        saved: "已保存",
        unsaved: "未保存",
        lineCol: "第 {line} 行，第 {column} 列",
        wordCount: (p: Record<string, string | number>) => `${Number(p.count).toLocaleString()} 词`,
        selectedWords: (p: Record<string, string | number>) =>
            `${Number(p.selected).toLocaleString()} / ${Number(p.total).toLocaleString()} 词`,
        selectedWordsAria: (p: Record<string, string | number>) =>
            `已选中 ${Number(p.total).toLocaleString()} 词中的 ${Number(p.selected).toLocaleString()} 词`,
        wordsAria: (p: Record<string, string | number>) => `${Number(p.count).toLocaleString()} 词`,
        selectionTitle: (p: Record<string, string | number>) =>
            `选中：${Number(p.words).toLocaleString()} 词、${Number(p.chars).toLocaleString()} 字符`,
        charsTitle: (p: Record<string, string | number>) => `${Number(p.count).toLocaleString()} 字符`,
        readingTimeTitle: "按每分钟 200 词估算的阅读时间",
        readingTime: (p: Record<string, string | number>) => {
            const min = Number(p.min);
            if (min < 1) return "阅读时间不足 1 分钟";
            if (min < 60) return `约 ${Math.round(min)} 分钟读完`;
            const hours = Math.floor(min / 60);
            const rem = Math.round(min % 60);
            return rem === 0 ? `约 ${hours} 小时读完` : `约 ${hours} 小时 ${rem} 分钟读完`;
        },
    },

    mobileBar: {
        menu: "菜单",
        appMenu: "应用菜单",
        unsavedChanges: "有未保存的修改",
        paletteAria: "搜索命令和笔记",
    },

    formatToolbar: {
        heading1: "标题 1",
        heading2: "标题 2",
        heading3: "标题 3",
        boldTitle: "加粗（{shortcut}）",
        italicTitle: "斜体（{shortcut}）",
        strikethrough: "删除线",
        inlineCode: "行内代码",
        bulletList: "无序列表",
        numberedList: "有序列表",
        taskList: "任务列表",
        blockquoteTitle: "引用（{shortcut}）",
        linkTitle: "链接（{shortcut}）",
        codeBlock: "代码块",
        insertTable: "插入表格",
        horizontalRule: "分隔线",
        aiAssistTitle: "AI 辅助（{shortcut}）",
    },

    tabBar: {
        openFiles: "打开的文件",
        unsavedName: "{name}（未保存）",
        closeNamed: "关闭 {name}",
        closeDirty: "有未保存的修改 — 点击关闭",
        close: "关闭",
        newTab: "新建标签页",
        newTabTitle: "新建标签页（Ctrl+N）",
    },

    editMenu: {
        ariaLabel: "编辑菜单",
        label: "编辑",
        find: "查找",
        replace: "查找和替换",
        findInFiles: "在文件中查找…",
    },

    modeToggle: {
        group: "视图模式切换",
        reader: "阅读",
        readerAria: "阅读模式",
        readerTitle: "阅读（Ctrl+E）",
        split: "分栏",
        splitAria: "分栏视图",
        splitTitle: "分栏视图（Ctrl+\\）",
        code: "代码",
        codeAria: "代码编辑器",
        codeTitle: "代码（Ctrl+E）",
    },

    exportMenu: {
        ariaLabel: "导出文档",
        label: "导出",
        exporting: "导出中…",
        formats: "导出格式",
        word: "Word (.docx)",
        nothing: "暂无可导出的内容",
    },

    zen: {
        bar: "禅模式顶栏",
        exitZen: "退出禅模式",
        normal: "普通视图",
        normalTitle: "返回普通视图（F9）",
        outlineOpen: "打开大纲",
        outlineClose: "关闭大纲",
        outlineTitle: "大纲（Ctrl+Shift+O）",
    },

    titleBar: {
        dropHint: "— 拖入 .md 文件，或按 ",
        edited: "— 已修改",
        newFile: "新建文件",
        newFileTitle: "新建文件（{shortcut}）",
        newLabel: "新建",
        openFile: "打开文件",
        openFileTitle: "打开文件（{shortcut}）",
        openLabel: "打开",
        aiAssistant: "AI 助手",
        minimize: "最小化",
        maximize: "最大化",
        exitFullscreen: "退出全屏",
        exitFullscreenTitle: "退出全屏（F11）",
        close: "关闭",
    },

    settingsMenu: {
        customSystemFont: "自定义系统字体",
        more: "更多设置…",
    },

    settings: {
        title: "设置",
        close: "关闭设置",
        searchPlaceholder: "搜索…",
        searchAriaLabel: "搜索设置",
        noResults: "没有匹配“{query}”的设置。",
        sectionAppearance: "外观",
        sectionEditor: "编辑器",
        sectionShortcuts: "快捷键",
        sectionAi: "AI",
        sectionAbout: "关于",

        language: "语言",
        languageSystem: "跟随系统（{language}）",
        languageHint: "界面按钮、菜单和提示所使用的语言。你的笔记内容不会被翻译。",
        languageAriaLabel: "界面语言",

        keywords: {
            appearance: "主题 外观 深色 浅色 纸张 午夜 强调色 配色 字体 字号 自定义 语言 中文 英文 interface chinese english",
            editor: "打字机 工具栏 自动换行 拼写检查 vim 自动保存 阅读模式 可读行宽 分栏 预览 禅模式 文字方向 从右到左 rtl ltr 阿拉伯语 希伯来语 波斯语 乌尔都语",
            shortcuts: "快捷键 键位 热键 重新绑定 新建 打开 保存 关闭 标签页 命令面板 跳转到行 切换 分栏 禅模式 全屏 资源管理器 大纲 搜索 设置 加粗 斜体 链接 引用 查找 替换 选择下一个匹配项",
            ai: "ai 助手 接口 模型 密钥 服务商 对话历史 openai ollama anthropic 人工智能",
            about: "关于 版本 更新 引导 教程 帮助 许可证",
        },

        theme: "主题",
        themeDark: "深色",
        themeGraphite: "石墨",
        themeNord: "Nord",
        themeMidnight: "午夜",
        themeLight: "浅色",
        themePaper: "纸张",
        themeDracula: "Dracula",
        accentColor: "强调色",
        accentColorAria: "强调色：{name}",
        font: "字体",
        fontCustom: "自定义",
        fontCustomKind: "系统字体",
        fontCustomPlaceholder: "例如 Atkinson Hyperlegible",
        fontCustomAria: "自定义系统字体",
        fontKindSans: "无衬线",
        fontKindSerif: "衬线",
        fontSize: "字号",
        fontSizeSmall: "小",
        fontSizeMedium: "中",
        fontSizeLarge: "大",
        fontSizeXlarge: "特大",

        typewriter: "打字机模式",
        typewriterHint: "光标始终保持在垂直方向居中",
        toolbar: "显示格式工具栏",
        toolbarHint: "编辑器上方的工具栏",
        wordWrap: "自动换行",
        wordWrapHint: "长行折行显示，而不是横向滚动",
        spellCheck: "拼写检查",
        spellCheckHint: "输入时给拼错的单词加下划线",
        vim: "Vim 模式",
        vimHint: "编辑器内的模态编辑：h/j/k/l、模式、操作符",
        autosave: "自动保存",
        autosaveHint: "停止输入片刻后自动保存",
        openInReader: "以阅读模式打开文件",
        openInReaderHint: "每个文件都先进入阅读模式，编辑只差一次点击",
        readableLength: "可读行宽",
        readableLengthHint: "把正文列居中到舒适的宽度（类似 Obsidian）。关闭后预览占满窗口",
        zenMode: "禅模式",
        zenModeHint: "只剩页面。Ctrl+E 进入编辑，F9 退出。",

        textDirection: "文字方向",
        textDirectionHint: "自动：跟随每一行的语言（阿拉伯语、希伯来语、波斯语等从右向左）。",
        textDirectionShortcutHint: " 在编辑器中，Ctrl+右 Shift 切到从右向左，Ctrl+左 Shift 切回自动。",
        directionAuto: "自动",
        directionLtr: "从左向右",
        directionRtl: "从右向左",

        aiEnable: "启用 AI",
        aiEnableHint: "在编辑器中显示 AI 按钮和助手",
        aiAnimateIcon: "AI 图标动画",
        aiAnimateIconHint: "标题栏 AI 按钮上的流光效果；关闭后按普通文字显示",
        aiIntroBefore:
            "配置一个兼容 OpenAI 的接口即可使用行内 AI 辅助（改写／缩写／扩写／续写／翻译）。在编辑器中用 ",
        aiIntroBetween: "、",
        aiIntroAfter: "工具栏按钮或命令面板打开。",
        aiStatusInvalidEndpoint: "接口地址无效",
        aiStatusInsecure: "接口不安全",
        aiStatusReady: "已就绪",
        aiStatusUnconfigured: "未配置",
        aiProvider: "服务商",
        aiProviderPresets: "AI 服务商预设",
        aiProviderHint:
            "选择一个服务商即可自动填入接口地址和模型，然后粘贴你的 API 密钥。其他兼容 OpenAI 的接口也可以，在下面手动填写。",
        aiProviderNameGemini: "Google Gemini",
        aiProviderNameOpenai: "OpenAI",
        aiProviderNameOllama: "Ollama（本地）",
        aiProviderNameLmstudio: "LM Studio（本地）",
        aiKeyHintGemini: "在 aistudio.google.com/apikey 免费申请密钥，然后粘贴到上面。",
        aiKeyHintOpenai: "在 platform.openai.com/api-keys 创建密钥，然后粘贴到上面。",
        aiKeyHintOllama: "无需密钥。所有数据都留在你的电脑上。",
        aiKeyHintLmstudio:
            "无需密钥。先在 LM Studio 的 Developer 标签页里启动服务；如果请求被拒绝，把「模型」填成已加载模型的 API 标识符。",
        aiEndpoint: "接口地址",
        aiEndpointPlaceholder: "https://api.openai.com/v1/chat/completions",
        aiEndpointInvalid: "必须是有效的 http:// 或 https:// 地址。",
        aiEndpointInsecure:
            "向该地址发送时会以明文传输 API 密钥。请改用 https://；如果这个服务不需要密钥，请清空密钥。",
        aiModel: "模型",
        aiModelPlaceholder: "gpt-4o-mini、claude-haiku-4-5、llama3……",
        aiApiKey: "API 密钥",
        aiApiKeyNeeded: "粘贴你的 {provider} API 密钥",
        aiApiKeyOptional: "（本地服务可不填）",
        aiApiKeyNotNeeded: "（该服务商不需要密钥）",
        aiHistoryDepth: "对话历史轮数",
        aiHistoryHint:
            "每次向 AI 面板发送消息时携带的历史对话轮数。数值越小越省 token；填 0 则每条消息都是全新的。当前文档始终只附加在最新一条消息上。",
        aiTest: "测试连接",
        aiTesting: "测试中…",
        aiTestOk: "✓ 连接正常",
        aiPrivacyLead: "隐私：你选中的文本会",
        aiPrivacyUnencrypted: "以明文",
        aiPrivacyMid: "发送到上面配置的接口。涉及私密笔记时请使用本地服务（例如 ",
        aiPrivacyTail:
            "），这样数据不会离开你的电脑。API 密钥保存在操作系统的凭据库中（Windows 凭据管理器、macOS 钥匙串或 Linux Secret Service），不以明文存储。",

        aboutTagline: "一个极简的 Markdown 编辑器",
        aboutBuiltWith: "使用 Tauri + React + TypeScript 构建。",
        aboutCreatedBy: "开发者",
        aboutShortcutHintBefore: "按 ",
        aboutShortcutHintAfter: " 查看全部快捷键。",
        aboutReplayTour: "重看新手引导",
        aboutReplayTourHint: "用 30 秒走一遍编辑器、视图和快捷键",
    },
};

export default zhCN;
