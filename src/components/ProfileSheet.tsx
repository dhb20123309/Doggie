// 工具箱-角色开场白/人物档案：侧边抽屉 + 聊天流内展开 + 独立静态页（三种形态同文件紧耦合）
// 排版对齐酒馆角色卡截图：立绘大图+名称、板块标题加粗无分割线、板块间留白、基础信息紧凑混排、警告浅红底
import { useRef, useState } from "react";
import { X, Wrench, FileText, MessageSquareQuote, Upload, ImagePlus, Clapperboard, ChevronDown } from "lucide-react";
import type { CharacterProfile } from "@/lib/character-profile";

/* ---------- 区块渲染（两种展示形态共用） ---------- */

function SectionBlock({ sec, profile, onLoadIntro }: {
  sec: CharacterProfile["sections"][number];
  profile: CharacterProfile;
  onLoadIntro?: () => void;
}) {
  if (sec.kind === "cover") {
    return (
      <div className="mb-5">
        <p className="mb-2 text-[13px] font-bold text-foreground">{sec.title}</p>
        {profile.coverUrl ? (
          <img src={profile.coverUrl} alt="立绘" className="mb-2 w-full rounded-2xl object-cover" />
        ) : (
          <div className="mb-2 flex h-40 w-full items-center justify-center rounded-2xl bg-black/[0.04] text-[11px] text-muted-foreground">
            未上传立绘 · 点击下方"上传图片"入口添加（1:1 或 3:4）
          </div>
        )}
        <p className="text-[15px] font-bold text-foreground">{profile.name}</p>
        {sec.paras.map((p, i) => (
          <p key={i} className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{p}</p>
        ))}
      </div>
    );
  }
  if (sec.kind === "warning") {
    return (
      <div className="mb-5">
        <p className="mb-2 text-[13px] font-bold text-foreground">{sec.title}</p>
        <div className="rounded-xl bg-red-50 px-3.5 py-3">
          {sec.paras.map((p, i) => (
            <p key={i} className="whitespace-pre-wrap text-[11.5px] leading-relaxed text-red-700/90">{p}</p>
          ))}
        </div>
      </div>
    );
  }
  const isStory = sec.kind === "story";
  return (
    <div className="mb-5">
      <p className="mb-2 text-[13px] font-bold text-foreground">{sec.title}</p>
      {/* 基础信息：紧凑自然混排文本；大段文本：流式段落自动换行 */}
      {sec.paras.map((p, i) => (
        <p key={i} className={`whitespace-pre-wrap break-words text-[12px] leading-relaxed text-foreground/80 ${i > 0 ? "mt-1.5" : ""}`}>
          {p}
        </p>
      ))}
      {isStory && onLoadIntro && (
        <button
          type="button"
          onClick={onLoadIntro}
          className="jelly-btn mt-2.5 flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-[11px] font-semibold text-primary-foreground"
        >
          <Clapperboard className="size-3" />
          一键加载到互动剧情模式
        </button>
      )}
    </div>
  );
}

/** 档案正文（固定弹窗内部纵向滚动由外层容器负责） */
export function ProfileBody({ profile, onLoadIntro, onUploadCover }: {
  profile: CharacterProfile;
  onLoadIntro?: () => void;
  onUploadCover?: (dataUrl: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const pickFile = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // 压缩到最长边 900px，转 data URL 持久化（blob 刷新即裂图）
        const scale = Math.min(1, 900 / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
        onUploadCover?.(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };
  return (
    <div className="px-4 pb-4 pt-3">
      {profile.sections.map((sec) => (
        <SectionBlock key={sec.key} sec={sec} profile={profile} onLoadIntro={onLoadIntro} />
      ))}
      {onUploadCover && (
        <>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0])}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="jelly-btn flex items-center gap-1.5 rounded-full glass px-3 py-1.5 text-[11px] font-medium text-secondary-foreground"
          >
            <ImagePlus className="size-3" />
            上传立绘/头像图片
          </button>
        </>
      )}
    </div>
  );
}

/* ---------- ① 工具箱菜单（聊天页左下角弹出） ---------- */

export function ToolboxMenu({ hasProfile, onOpenProfile, onShowOpener, onImport, onClose }: {
  hasProfile: boolean;
  onOpenProfile: () => void;
  onShowOpener: () => void;
  onImport: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="absolute inset-0 z-30 bg-black/20" onClick={onClose} aria-hidden />
      <div className="glass-strong absolute bottom-16 left-3 z-40 w-44 fade-up overflow-hidden rounded-2xl p-1.5 shadow-xl">
        <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold tracking-wide text-muted-foreground">工具箱</p>
        <button type="button" onClick={onShowOpener} className="jelly-btn flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[12px] font-medium text-foreground">
          <MessageSquareQuote className="size-3.5 shrink-0 text-primary" />
          角色开场白
        </button>
        <button
          type="button"
          onClick={onOpenProfile}
          disabled={!hasProfile}
          className="jelly-btn flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[12px] font-medium text-foreground disabled:opacity-40"
        >
          <FileText className="size-3.5 shrink-0 text-primary" />
          人物档案
        </button>
        <button type="button" onClick={onImport} className="jelly-btn flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[12px] font-medium text-foreground">
          <Upload className="size-3.5 shrink-0 text-primary" />
          导入档案文本
        </button>
      </div>
    </>
  );
}

export function ToolboxButton({ onClick, open }: { onClick: () => void; open: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="工具箱"
      className={`jelly-icon flex size-8 shrink-0 items-center justify-center rounded-full transition-colors ${open ? "bg-primary text-primary-foreground" : "glass text-secondary-foreground"}`}
    >
      <Wrench className="size-4" />
    </button>
  );
}

/* ---------- ② 侧边抽屉（固定尺寸，内部纵向滚动；底层蒙层由父级渲染） ---------- */

export function ProfileDrawer({ profile, onClose, onLoadIntro, onUploadCover }: {
  profile: CharacterProfile;
  onClose: () => void;
  onLoadIntro?: () => void;
  onUploadCover?: (dataUrl: string) => void;
}) {
  return (
    <>
      <div className="absolute inset-0 z-40 bg-black/30 drawer-scrim" onClick={onClose} aria-hidden />
      <aside className="drawer-panel absolute inset-y-0 right-0 z-50 flex w-[86%] max-w-[320px] flex-col bg-card shadow-2xl">
        <header className="glass-nav flex items-center justify-between border-b border-border/60 px-3.5 py-2.5">
          <p className="text-[13px] font-bold text-foreground">人物档案｜{profile.name}</p>
          <button type="button" onClick={onClose} aria-label="关闭档案" className="jelly-icon flex size-7 items-center justify-center rounded-full text-muted-foreground">
            <X className="size-4" />
          </button>
        </header>
        {/* 弹窗尺寸固定，内容过长只在内部滚动 */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          <ProfileBody profile={profile} onLoadIntro={onLoadIntro} onUploadCover={onUploadCover} />
        </div>
      </aside>
    </>
  );
}

/* ---------- ③ 独立静态页面（工具箱进入：只有关闭按钮，没有一键收起） ---------- */

export function ProfileStandalonePage({ profile, onClose, onLoadIntro }: {
  profile: CharacterProfile;
  onClose: () => void;
  onLoadIntro?: () => void;
}) {
  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-background fade-up">
      <header className="glass-nav flex items-center justify-between border-b border-border/60 px-3.5 py-2.5">
        <p className="text-[13px] font-bold text-foreground">人物档案｜{profile.name}</p>
        <button type="button" onClick={onClose} aria-label="关闭" className="jelly-icon flex size-7 items-center justify-center rounded-full text-muted-foreground">
          <X className="size-4" />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto overscroll-contain">
        <ProfileBody profile={profile} onLoadIntro={onLoadIntro} />
      </div>
    </div>
  );
}

/* ---------- ④ 会话顶部开场白条（默认折叠，点击在聊天流内一次性全展开） ---------- */

export function OpenerStrip({ opener, expanded, onToggle }: {
  opener: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button type="button" onClick={onToggle} className="jelly-blob glass mx-auto mb-2 flex w-full max-w-[92%] items-center gap-2 rounded-xl px-3 py-2 text-left">
      <MessageSquareQuote className="size-3.5 shrink-0 text-primary" />
      <span className="line-clamp-1 flex-1 text-[11px] leading-relaxed text-muted-foreground">{opener}</span>
      <ChevronDown className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
    </button>
  );
}

/* ---------- ⑤ 聊天流内展开的完整档案（禁止局部折叠/分步加载，底部固定一键收起） ---------- */

export function InlineProfileCard({ profile, onCollapse, onLoadIntro }: {
  profile: CharacterProfile;
  onCollapse: () => void;
  onLoadIntro?: () => void;
}) {
  return (
    <div className="fade-up mx-auto mb-2 w-full max-w-[96%] rounded-2xl bg-black/[0.05] backdrop-blur-sm">
      <ProfileBody profile={profile} onLoadIntro={onLoadIntro} />
      <div className="sticky bottom-0 flex justify-center rounded-b-2xl bg-gradient-to-t from-[var(--bubble-cream,#fbf6ea)] via-[var(--bubble-cream,#fbf6ea)] to-transparent px-3 pb-3 pt-2">
        <button
          type="button"
          onClick={onCollapse}
          className="jelly-btn flex items-center gap-1.5 rounded-full glass px-4 py-1.5 text-[11px] font-semibold text-secondary-foreground"
        >
          <ChevronDown className="size-3 rotate-180" />
          一键收起
        </button>
      </div>
    </div>
  );
}

/* ---------- ⑥ 档案导入面板（粘贴完整档案文本，自动识别区块） ---------- */

export function ProfileImportPanel({ defaultName, onImport, onClose }: {
  defaultName: string;
  onImport: (name: string, text: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [name, setName] = useState(defaultName);
  return (
    <div className="glass-strong absolute inset-x-3 top-14 z-50 fade-up rounded-2xl p-3.5 shadow-xl">
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-[13px] font-bold text-foreground"><Upload className="size-3.5 text-primary" />导入角色档案</p>
        <button type="button" onClick={onClose} aria-label="关闭导入" className="jelly-icon flex size-6 items-center justify-center rounded-full text-muted-foreground"><X className="size-3.5" /></button>
      </div>
      <p className="mb-2 text-[10.5px] leading-relaxed text-muted-foreground">粘贴完整档案文本（md 或纯文本），自动识别：封面占位 / 基础信息 / 家人信息 / 标签 / 世界观 / ⚠️警告 / 社交预览 / 开局引子 / 开局剧情片段。</p>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="角色名" className="glass-input mb-2 w-full rounded-xl px-3 py-2 text-[12px] text-foreground outline-none" />
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={7} placeholder="把档案全文粘贴到这里…" className="glass-input w-full resize-none rounded-xl px-3 py-2 text-[12px] leading-relaxed text-foreground outline-none" />
      <button
        type="button"
        disabled={!text.trim()}
        onClick={() => onImport(name.trim() || defaultName, text)}
        className="jelly-btn mt-2 w-full rounded-full bg-primary py-2 text-[12px] font-semibold text-primary-foreground disabled:opacity-40"
      >
        识别并导入
      </button>
    </div>
  );
}
