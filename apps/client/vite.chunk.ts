import type { Rolldown } from 'vite'
type CodeSplitting = Rolldown.CodeSplittingGroup

export const chunks: CodeSplitting[] = [
  // ========== 最高优先级 (100)：Monorepo 与核心业务代码 ==========
  {
    name: 'workspace-deps',
    priority: 100,
    test(id) {
      const patterns = [/[\\/]packages[\\/](cogito|wasm)[\\/]/]
      return patterns.some((pattern) => pattern.test(id))
    }
  },
  {
    name: 'cogito-apis',
    priority: 100,
    test(id) {
      const patterns = [/[\\/]src[\\/]apis[\\/]/]
      return patterns.some((pattern) => pattern.test(id))
    }
  },
  {
    name: 'core-themes',
    priority: 100,
    test(id) {
      const patterns = [/[\\/]src[\\/]themes[\\/]/]
      return patterns.some((pattern) => pattern.test(id))
    }
  },
  {
    name: 'core-routers',
    priority: 100,
    test(id) {
      const patterns = [/[\\/]src[\\/]routers[\\/]/]
      return patterns.some((pattern) => pattern.test(id))
    }
  },
  {
    name: 'core-utils',
    priority: 100,
    test(id) {
      const patterns = [/[\\/]src[\\/]utils[\\/]/]
      return patterns.some((pattern) => pattern.test(id))
    }
  },
  {
    name: 'core-hooks',
    priority: 100,
    test(id) {
      const patterns = [/[\\/]src[\\/]hooks[\\/]/]
      return patterns.some((pattern) => pattern.test(id))
    }
  },
  {
    name: 'core-stores',
    priority: 100,
    test(id) {
      const patterns = [/[\\/]src[\\/]stores[\\/]/]
      return patterns.some((pattern) => pattern.test(id))
    }
  },
  {
    name: 'core-assets',
    priority: 100,
    test(id) {
      const patterns = [/[\\/]src[\\/]assets[\\/]/]
      return patterns.some((pattern) => pattern.test(id))
    }
  },
  {
    name: 'core-locales',
    priority: 100,
    test(id) {
      const patterns = [/[\\/]src[\\/]locales[\\/]/]
      return patterns.some((pattern) => pattern.test(id))
    }
  },
  {
    name: 'core-database',
    priority: 100,
    test(id) {
      const patterns = [/[\\/]src[\\/]database[\\/]/]
      return patterns.some((pattern) => pattern.test(id))
    }
  },
  {
    name(id) {
      const view = id.match(/[\\/]views[\\/]([^\\/]+)[\\/]/)
      if (view) return `tile-${view[1]}`
      const tile = id.match(/[\\/]magnetic-tiles[\\/]([^\\/]+)[\\/]/)
      return tile ? `tile-${tile[1]}` : null
    },
    priority: 80,
    test(id) {
      // 磁贴窗口页在 `views/<component>/`，磁贴表面在 `features/magnetic-tiles/<component>/`：同一个组
      return /[\\/]views[\\/]/.test(id) || /[\\/]magnetic-tiles[\\/]/.test(id)
    }
  },
  {
    name: 'core-components',
    priority: 100,
    test(id) {
      const patterns = [/[\\/]src[\\/]core-components[\\/]/]
      return patterns.some((pattern) => pattern.test(id))
    }
  },

  // ========== 高优先级 (90)：React 核心生态与路由 ==========
  {
    name: 'core-framework',
    priority: 90,
    test(id) {
      const patterns = [/[\\/]node_modules[\\/](react|react-dom)[\\/]/]
      return patterns.some((pattern) => pattern.test(id))
    }
  },
  {
    name: 'router',
    priority: 90,
    test(id) {
      const patterns = [
        /[\\/]node_modules[\\/]@remix-run[\\/]router[\\/]/,
        /[\\/]node_modules[\\/]react-router[\\/]/,
        /[\\/]node_modules[\\/]react-router-dom[\\/]/
      ]
      return patterns.some((pattern) => pattern.test(id))
    }
  },
  {
    name: 'scheduler',
    priority: 90,
    test(id) {
      const patterns = [
        /[\\/]node_modules[\\/](scheduler)[\\/]/,
        /[\\/]node_modules[\\/]@tauri-apps[\\/]/
      ]
      return patterns.some((pattern) => pattern.test(id))
    }
  },

  // ========== 中优先级 (50)：UI 组件库 ==========
  {
    name: 'ui',
    priority: 50,
    test(id) {
      const patterns = [
        /[\\/]node_modules[\\/]@cogito[\\/]design[\\/]/,
        /[\\/]node_modules[\\/]@cogito[\\/]chat[\\/]/,
        /[\\/]node_modules[\\/]@base-ui[\\/]/,
        /[\\/]node_modules[\\/]@assistant-ui[\\/]/,
        /[\\/]node_modules[\\/]assistant-stream[\\/]/,
        /[\\/]node_modules[\\/](class-variance-authority|tailwind-merge|tw-shimmer|sonner|react-hook-form|react-resizable-panels)[\\/]/,
        /[\\/]node_modules[\\/](remark-gfm|mdast-|micromark|unified|unist-|hast-|vfile|decode-named-character-reference)[\\/]/,
        /[\\/]node_modules[\\/]react-remove-scroll[\\/]/,
        /[\\/]node_modules[\\/]@floating-ui[\\/]/,
        /[\\/]node_modules[\\/](mermaid)[\\/]/,
        /[\\/]node_modules[\\/]ts-dedent[\\/]/,
        /[\\/]node_modules[\\/]roughjs[\\/]/,
        /[\\/]node_modules[\\/]@iconify[\\/]/,
        /[\\/]node_modules[\\/]khroma[\\/]/,
        /[\\/]node_modules[\\/]katex[\\/]/,
        /[\\/]node_modules[\\/]cytoscape[\\/]/,
        /[\\/]node_modules[\\/]cytoscape-/,
        /[\\/]node_modules[\\/]cose-base[\\/]/,
        /[\\/]node_modules[\\/]layout-base[\\/]/,
        /[\\/]node_modules[\\/]langium[\\/]/,
        /[\\/]node_modules[\\/]vscode-/,
        /[\\/]node_modules[\\/]@mermaid-js[\\/]/,
        /[\\/]node_modules[\\/]chevrotain[\\/]/,
        /[\\/]node_modules[\\/]chevrotain-/,
        /[\\/]node_modules[\\/]@chevrotain[\\/]/,
        /[\\/]node_modules[\\/]character-/,
        /[\\/]node_modules[\\/]fault[\\/]/,
        /[\\/]node_modules[\\/]format[\\/]/,
        /[\\/]node_modules[\\/]delaunator[\\/]/,
        /[\\/]node_modules[\\/]is-hexadecimal[\\/]/,
        /[\\/]node_modules[\\/]is-alphanumerical[\\/]/,
        /[\\/]node_modules[\\/]is-decimal[\\/]/,
        /[\\/]node_modules[\\/]parse-entities[\\/]/,
        /[\\/]node_modules[\\/]dagre-d3-es[\\/]/,
        /[\\/]node_modules[\\/]internmap[\\/]/,
        /[\\/]node_modules[\\/]robust-predicates[\\/]/,
        /[\\/]node_modules[\\/]is-alphabetical[\\/]/,
        /[\\/]node_modules[\\/]@braintree[\\/]/,
        /[\\/]node_modules[\\/]classnames[\\/]/,
        /[\\/]node_modules[\\/]lodash.throttle[\\/]/,
        /[\\/]node_modules[\\/]react-syntax-highlighter[\\/]/,
        /[\\/]node_modules[\\/]refractor[\\/]/,
        /[\\/]node_modules[\\/]scroll-into-view-if-needed[\\/]/,
        /[\\/]node_modules[\\/]compute-scroll-into-view[\\/]/,
        /[\\/]node_modules[\\/]html-react-parser[\\/]/,
        /[\\/]node_modules[\\/]html-dom-parser[\\/]/,
        /[\\/]node_modules[\\/]domhandler[\\/]/,
        /[\\/]node_modules[\\/]react-property[\\/]/,
        /[\\/]node_modules[\\/]toggle-selection[\\/]/,
        /[\\/]node_modules[\\/]domelementtype[\\/]/
      ]
      return patterns.some((pattern) => pattern.test(id))
    }
  },
  {
    name: 'ui-radix',
    priority: 50,
    test(id) {
      const patterns = [
        /[\\/]node_modules[\\/]@radix-ui[\\/]/,
        /[\\/]node_modules[\\/]react-remove-scroll[\\/]/,
        /[\\/]node_modules[\\/]use-sidecar[\\/]/,
        /[\\/]node_modules[\\/]aria-hidden[\\/]/,
        /[\\/]node_modules[\\/]react-remove-scroll-bar[\\/]/,
        /[\\/]node_modules[\\/]use-callback-ref[\\/]/,
        /[\\/]node_modules[\\/]react-style-singleton[\\/]/,
        /[\\/]node_modules[\\/]detect-node-es[\\/]/,
        /[\\/]node_modules[\\/]get-nonce[\\/]/
      ]
      return patterns.some((pattern) => pattern.test(id))
    }
  },
  {
    name: 'ui-marks',
    priority: 50,
    test(id) {
      const patterns = [/[\\/]node_modules[\\/]@iconify[\\/](?:json|react|vue)[\\/]/]
      return patterns.some((pattern) => pattern.test(id))
    }
  },
  {
    name: 'ui-animation',
    priority: 50,
    test(id) {
      const patterns = [
        /[\\/]node_modules[\\/]gsap[\\/]/,
        /[\\/]node_modules[\\/]swiper[\\/]/,
        /[\\/]node_modules[\\/]motion[\\/]/,
        /[\\/]node_modules[\\/]framer-motion[\\/]/,
        /[\\/]node_modules[\\/]motion-dom[\\/]/,
        /[\\/]node_modules[\\/]motion-utils[\\/]/
      ]
      return patterns.some((pattern) => pattern.test(id))
    }
  },

  // ========== 中优先级 (50)：各类工具库与媒体处理 ==========
  {
    name: 'utils-media',
    priority: 50,
    test(id) {
      const patterns = [
        /[\\/]node_modules[\\/]mp4box[\\/]/,
        /[\\/]node_modules[\\/]@ffmpeg[\\/]/,
        /[\\/]node_modules[\\/]ffmpeg-core\.(js|wasm|worker\.js)$/
      ]
      return patterns.some((pattern) => pattern.test(id))
    }
  },
  {
    name: 'utils-canvas',
    priority: 50,
    test(id) {
      const patterns = [
        /[\\/]node_modules[\\/]konva[\\/]/,
        /[\\/]node_modules[\\/]react-konva[\\/]/,
        /[\\/]node_modules[\\/]react-konva-utils[\\/]/,
        /[\\/]node_modules[\\/]use-image[\\/]/,
        /[\\/]node_modules[\\/]its-fine[\\/]/,
        /[\\/]node_modules[\\/]react-reconciler[\\/]/
      ]
      return patterns.some((pattern) => pattern.test(id))
    }
  },
  {
    name: 'utils-core',
    priority: 50,
    test(id) {
      const patterns = [
        /[\\/]node_modules[\\/]lodash-es[\\/]/,
        /[\\/]node_modules[\\/]rxjs[\\/]/,
        /[\\/]node_modules[\\/]uuid[\\/]/,
        /[\\/]node_modules[\\/]clsx[\\/]/,
        /[\\/]node_modules[\\/]reflect-metadata[\\/]/,
        /[\\/]node_modules[\\/]@reactuses[\\/]/,
        /[\\/]node_modules[\\/]@microsoft[\\/]/,
        /[\\/]node_modules[\\/]js-cookie[\\/]/,
        /[\\/]node_modules[\\/]nano-css[\\/]/,
        /[\\/]node_modules[\\/]react-universal-interface[\\/]/,
        /[\\/]node_modules[\\/]screenfull[\\/]/,
        /[\\/]node_modules[\\/]set-harmonic-interval[\\/]/,
        /[\\/]node_modules[\\/]ts-easing[\\/]/,
        /[\\/]node_modules[\\/]fast-shallow-equal[\\/]/,
        /[\\/]node_modules[\\/]fast-deep-equal[\\/]/,
        /[\\/]node_modules[\\/]copy-to-clipboard[\\/]/,
        /[\\/]node_modules[\\/]@xobotyi[\\/]/
      ]
      return patterns.some((pattern) => pattern.test(id))
    }
  },
  {
    name: 'utils-markdown',
    priority: 50,
    test(id) {
      const patterns = [
        /[\\/]node_modules[\\/]rehype-/,
        /[\\/]node_modules[\\/]hast-util-raw[\\/]/,
        /[\\/]node_modules[\\/]hastscript[\\/]/,
        /[\\/]node_modules[\\/]@ungap\/structured-clone[\\/]/,
        /[\\/]node_modules[\\/]hast-util-from-parse5[\\/]/,
        /[\\/]node_modules[\\/]vfile-location[\\/]/,
        /[\\/]node_modules[\\/]hast-util-to-parse5[\\/]/,
        /[\\/]node_modules[\\/]html-void-elements[\\/]/,
        /[\\/]node_modules[\\/]parse5[\\/]/,
        /[\\/]node_modules[\\/]entities[\\/]/,
        /[\\/]node_modules[\\/]unist-util-position[\\/]/,
        /[\\/]node_modules[\\/]unist-util-visit[\\/]/,
        /[\\/]node_modules[\\/]unist-util-is[\\/]/,
        /[\\/]node_modules[\\/]unist-util-visit-parents[\\/]/,
        /[\\/]node_modules[\\/]web-namespaces[\\/]/,
        /[\\/]node_modules[\\/]zwitch[\\/]/,
        /[\\/]node_modules[\\/]vfile[\\/]/,
        /[\\/]node_modules[\\/]hast-util-to-text[\\/]/,
        /[\\/]node_modules[\\/]hast-util-is-element[\\/]/,
        /[\\/]node_modules[\\/]hast-util-parse-selector[\\/]/,
        /[\\/]node_modules[\\/]unist-util-find-after[\\/]/,
        /[\\/]node_modules[\\/]remark-/,
        /[\\/]node_modules[\\/]unified[\\/]/,
        /[\\/]node_modules[\\/]bail[\\/]/,
        /[\\/]node_modules[\\/]trough[\\/]/,
        /[\\/]node_modules[\\/]is-plain-obj[\\/]/,
        /[\\/]node_modules[\\/]extend[\\/]/,
        /[\\/]node_modules[\\/]ccount[\\/]/,
        /[\\/]node_modules[\\/]mdast-util-gfm[\\/]/,
        /[\\/]node_modules[\\/]mdast-util-gfm-autolink-literal[\\/]/,
        /[\\/]node_modules[\\/]mdast-util-find-and-replace[\\/]/,
        /[\\/]node_modules[\\/]mdast-util-phrasing[\\/]/,
        /[\\/]node_modules[\\/]escape-string-regexp[\\/]/,
        /[\\/]node_modules[\\/]mdast-util-gfm-footnote[\\/]/,
        /[\\/]node_modules[\\/]micromark-core-commonmark[\\/]/,
        /[\\/]node_modules[\\/]micromark-factory-space[\\/]/,
        /[\\/]node_modules[\\/]micromark-util-character[\\/]/,
        /[\\/]node_modules[\\/]micromark-util-normalize-identifier[\\/]/,
        /[\\/]node_modules[\\/]micromark-util-sanitize-uri[\\/]/,
        /[\\/]node_modules[\\/]micromark-util-symbol[\\/]/,
        /[\\/]node_modules[\\/]micromark-util-types[\\/]/,
        /[\\/]node_modules[\\/]mdast-util-gfm-strikethrough[\\/]/,
        /[\\/]node_modules[\\/]mdast-util-gfm-table[\\/]/,
        /[\\/]node_modules[\\/]markdown-table[\\/]/,
        /[\\/]node_modules[\\/]mdast-util-gfm-task-list-item[\\/]/,
        /[\\/]node_modules[\\/]mdast-util-from-markdown[\\/]/,
        /[\\/]node_modules[\\/]mdast-util-to-markdown[\\/]/,
        /[\\/]node_modules[\\/]mdast-util-to-string[\\/]/,
        /[\\/]node_modules[\\/]longest-streak[\\/]/,
        /[\\/]node_modules[\\/]decode-named-character-reference[\\/]/,
        /[\\/]node_modules[\\/]micromark[\\/]/,
        /[\\/]node_modules[\\/]micromark-util-decode-numeric-character-reference[\\/]/,
        /[\\/]node_modules[\\/]micromark-util-decode-string[\\/]/,
        /[\\/]node_modules[\\/]unist-util-stringify-position[\\/]/,
        /[\\/]node_modules[\\/]micromark-extension-gfm[\\/]/,
        /[\\/]node_modules[\\/]micromark-util-combine-extensions[\\/]/,
        /[\\/]node_modules[\\/]micromark-extension-gfm-autolink-literal[\\/]/,
        /[\\/]node_modules[\\/]micromark-extension-gfm-footnote[\\/]/,
        /[\\/]node_modules[\\/]micromark-extension-gfm-strikethrough[\\/]/,
        /[\\/]node_modules[\\/]micromark-extension-gfm-table[\\/]/,
        /[\\/]node_modules[\\/]micromark-extension-gfm-tagfilter[\\/]/,
        /[\\/]node_modules[\\/]micromark-extension-gfm-task-list-item[\\/]/,
        /[\\/]node_modules[\\/]micromark-util-chunked[\\/]/,
        /[\\/]node_modules[\\/]micromark-util-classify-character[\\/]/,
        /[\\/]node_modules[\\/]micromark-util-resolve-all[\\/]/,
        /[\\/]node_modules[\\/]micromark-util-encode[\\/]/,
        /[\\/]node_modules[\\/]micromark-util-subtokenize[\\/]/,
        /[\\/]node_modules[\\/]micromark-factory-destination[\\/]/,
        /[\\/]node_modules[\\/]micromark-factory-label[\\/]/,
        /[\\/]node_modules[\\/]micromark-factory-title[\\/]/,
        /[\\/]node_modules[\\/]micromark-factory-whitespace[\\/]/,
        /[\\/]node_modules[\\/]micromark-util-html-tag-name[\\/]/,
        /[\\/]node_modules[\\/]marked[\\/]/,
        /[\\/]node_modules[\\/]prosemirror-/,
        /[\\/]node_modules[\\/]rope-sequence[\\/]/,
        /[\\/]node_modules[\\/]orderedmap[\\/]/,
        /[\\/]node_modules[\\/]w3c-keyname[\\/]/,
        /[\\/]node_modules[\\/]dompurify[\\/]/,
        /[\\/]node_modules[\\/]@floating-ui[\\/]/,
        /[\\/]node_modules[\\/]tabbable[\\/]/,
        /[\\/]node_modules[\\/]react-markdown[\\/]/,
        /[\\/]node_modules[\\/]devlop[\\/]/,
        /[\\/]node_modules[\\/]html-url-attributes[\\/]/,
        /[\\/]node_modules[\\/]mdast-util-to-hast[\\/]/,
        /[\\/]node_modules[\\/]trim-lines[\\/]/,
        /[\\/]node_modules[\\/]hast-util-to-jsx-runtime[\\/]/,
        /[\\/]node_modules[\\/]style-to-js[\\/]/,
        /[\\/]node_modules[\\/]style-to-object[\\/]/,
        /[\\/]node_modules[\\/]inline-style-parser[\\/]/,
        /[\\/]node_modules[\\/]vfile-message[\\/]/,
        /[\\/]node_modules[\\/]space-separated-tokens[\\/]/,
        /[\\/]node_modules[\\/]property-information[\\/]/,
        /[\\/]node_modules[\\/]comma-separated-tokens[\\/]/,
        /[\\/]node_modules[\\/]estree-util-is-identifier-name[\\/]/,
        /[\\/]node_modules[\\/]hast-util-whitespace[\\/]/,
        /[\\/]node_modules[\\/]mdast-util-mdx-expression[\\/]/,
        /[\\/]node_modules[\\/]mdast-util-mdx-jsx[\\/]/,
        /[\\/]node_modules[\\/]mdast-util-mdxjs-esm[\\/]/,
        /[\\/]node_modules[\\/]@tiptap[\\/]/,
        /[\\/]node_modules[\\/]fast-equals[\\/]/,
        /[\\/]node_modules[\\/]linkifyjs[\\/]/,
        /[\\/]node_modules[\\/]use-sync-external-store[\\/]/,
        /[\\/]node_modules[\\/]@ariakit[\\/]/
      ]
      return patterns.some((pattern) => pattern.test(id))
    }
  },
  {
    name: 'utils-code',
    priority: 50,
    test(id) {
      const patterns = [/[\\/]node_modules[\\/](monaco-editor|highlight\.js|lowlight)[\\/]/]
      return patterns.some((pattern) => pattern.test(id))
    }
  },
  {
    name: 'utils-datetime',
    priority: 50,
    test(id) {
      const patterns = [/[\\/]node_modules[\\/](dayjs|lunisolar|tyme4ts|lunar-typescript)[\\/]/]
      return patterns.some((pattern) => pattern.test(id))
    }
  },
  {
    name: 'utils-crypto',
    priority: 50,
    test(id) {
      const patterns = [/[\\/]node_modules[\\/]crypto-js[\\/]/]
      return patterns.some((pattern) => pattern.test(id))
    }
  },
  {
    name: 'utils-matches',
    priority: 50,
    test(id) {
      const patterns = [/[\\/]node_modules[\\/]fuse\.js[\\/]/]
      return patterns.some((pattern) => pattern.test(id))
    }
  },
  {
    name: 'utils-math',
    priority: 50,
    test(id) {
      const patterns = [
        /[\\/]node_modules[\\/](mathjs|complex\.js|decimal\.js|escape-latex|fraction\.js)[\\/]/,
        /[\\/]node_modules[\\/](javascript-natural-sort|seedrandom|tiny-emitter|typed-function)[\\/]/
      ]
      return patterns.some((pattern) => pattern.test(id))
    }
  },
  {
    name: 'utils-enhance',
    priority: 50,
    test(id) {
      const patterns = [
        /[\\/]node_modules[\\/]qrcode[\\/]/,
        /[\\/]node_modules[\\/]d3[\\/]/,
        /[\\/]node_modules[\\/]react-hotkeys-hook[\\/]/,
        /[\\/]node_modules[\\/]d3-/
      ]
      return patterns.some((pattern) => pattern.test(id))
    }
  },
  {
    name: 'utils-network',
    priority: 50,
    test(id) {
      const patterns = [
        /[\\/]node_modules[\\/]@ngify[\\/]/,
        /[\\/]node_modules[\\/](axios|follow-redirects|form-data|proxy-from-env|cookie|set-cookie-parser)[\\/]/
      ]
      return patterns.some((pattern) => pattern.test(id))
    }
  },
  {
    name: 'utils-store',
    priority: 50,
    test(id) {
      const patterns = [
        /[\\/]node_modules[\\/]zustand[\\/]/,
        /[\\/]node_modules[\\/]immer[\\/]/,
        /[\\/]node_modules[\\/]tslib[\\/]/
      ]
      return patterns.some((pattern) => pattern.test(id))
    }
  },
  {
    name: 'utils-storage',
    priority: 50,
    test(id) {
      const patterns = [
        /[\\/]node_modules[\\/]dexie[\\/]/,
        /[\\/]node_modules[\\/]dexie-/,
        /[\\/]node_modules[\\/]lib0[\\/]/,
        /[\\/]node_modules[\\/]y-dexie[\\/]/,
        /[\\/]node_modules[\\/]y-protocols[\\/]/,
        /[\\/]node_modules[\\/]yjs[\\/]/
      ]
      return patterns.some((pattern) => pattern.test(id))
    }
  },
  {
    name: 'utils-validation',
    priority: 50,
    test(id) {
      const patterns = [/[\\/]node_modules[\\/](zod)[\\/]/]
      return patterns.some((pattern) => pattern.test(id))
    }
  },
  {
    name: 'utils-polyfill',
    priority: 50,
    test(id) {
      const patterns = [/[\\/]node_modules[\\/]@babel[\\/]/]
      return patterns.some((pattern) => pattern.test(id))
    }
  },
  {
    name: 'utils-interaction',
    priority: 50,
    test(id) {
      const patterns = [/[\\/]node_modules[\\/]sortablejs[\\/]/]
      return patterns.some((pattern) => pattern.test(id))
    }
  },
  {
    name: 'utils-dnd',
    priority: 50,
    test(id) {
      const patterns = [/[\\/]node_modules[\\/]@dnd-kit[\\/]/]
      return patterns.some((pattern) => pattern.test(id))
    }
  },

  // ========== 最低优先级 (0)：兜底所有剩余 node_modules ==========
  {
    name: 'unknown-deps',
    priority: 0,
    test(id) {
      // 原配置中为空数组，这里显式限定为 node_modules 兜底，防止业务代码意外掉入
      const patterns = [/[\\/]node_modules[\\/]/]
      return patterns.some((pattern) => pattern.test(id))
    }
  }
]
