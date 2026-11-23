// 工具箱-角色开场白/人物档案：侧边抽屉 + 聊天流内展开 + 独立静态页（形态同文件紧耦合）
// UI 复刻用户提供的酒馆角色卡截图：居中"名字 × 你"大标题、标签胶囊横排、
// 立绘与文字左右并置、子标题竖线锚点、板块间只用留白无分割线、警告浅红底高亮
import { useRef, useState } from "react";
import { X, Wrench, FileText, MessageSquareQuote, Upload, ImagePlus, Clapperboard, ChevronDown, Banknote, MapPin } from "lucide-react";
import type { CharacterProfile, ProfileSection } from "@/lib/character-profile";
import { presetProfileFor } from "@/lib/character-profile";
import { presetPhoto } from "@/lib/chat-store";

/** 预置角色未上传立绘时，用定妆照作档案封面（用户自导角色无回落） */
function presetCover(charId: string): string {
  if (!charId.startsWith("zhou-")) return "";
  return presetPhoto(charId);
}

/* ---------- 区块渲染（两种展示形态共用，排版对齐酒馆截图） ---------- */

/** 子标题：左侧短竖线锚点（截图中"身份 / 性格"样式），不加分割线 */
function SubTitle({ children }: { children: string }) {
  return (
    <p className="mb-1 mt-3 flex items-center gap-1.5 text-[12px] font-bold text-foreground/85">
      <span aria-hidden className="h-3 w-[2px] shrink-0 rounded-full bg-primary/60" />
      {children}
    </p>
  );
}

/** 键值行："姓名：周晨砚｜性别：男…" → 标签弱化、值正常，紧凑自然混排非整齐列表 */
function KVLine({ line }: { line: string }) {
  const m = line.match(/^(.{1,6}?)[:：](.+)$/);
  if (!m) return <p className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-foreground/80">{line}</p>;
  return (
    <p className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-foreground/80">
      <span className="text-muted-foreground">{m[1]}：</span>
      {m[2]}
    </p>
  );
}

function BasicBody({ paras }: { paras: string[] }) {
  return (
    <div>
      {paras.map((p, i) => (
        <KVLine key={i} line={p} />
      ))}
    </div>
  );
}

/** 性格内核类：首行含"表面/内在"时按子标题分组混排 */
function PersonalityBody({ paras }: { paras: string[] }) {
  const hasFacets = paras.some((p) => /^(表面|内在|争宠表现)[:：]/.test(p));
  if (!hasFacets) return <BasicBody paras={paras} />;
  return (
    <div>
      {paras.map((p, i) => {
        const m = p.match(/^(表面|内在|争宠表现)[:：]\s*(.+)$/);
        if (m) {
          return (
            <div key={i}>
              <SubTitle>{m[1]}</SubTitle>
              <p className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-foreground/80">{m[2]}</p>
            </div>
          );
        }
        return <KVLine key={i} line={p} />;
      })}
    </div>
  );
}

/* ---------- 朋友圈预览（社交账号分节专属：仿微信朋友圈九宫格动态卡） ---------- */

interface MomentPost {
  img: string;
  ratio: "4/3" | "3/4";
  text: string;
  time: string;
  likes: string;
}

const MOMENTS: Record<string, MomentPost[]> = {
  "zhou-chenyan": [
    {
      img: presetPhoto("zhou-chenyan"),
      ratio: "3/4",
      text: "今天夕阳不错，可惜某人不在场边。",
      time: "昨天 18:47",
      likes: "周风砚、篮球队长、乐团首席 等 23 人",
    },
    {
      img: presetPhoto("zhou-chenyan"),
      ratio: "3/4",
      text: "赢了。两杯奶茶，一杯是我的，另一杯你猜。",
      time: "3 天前",
      likes: "周风砚、死党A 等 18 人",
    },
  ],
  "zhou-fengyan": [
    {
      img: presetPhoto("zhou-fengyan"),
      ratio: "3/4",
      text: "画到一半，嘴角的弧度有点不受控制。☕️",
      time: "前天 15:20",
      likes: "美术社全员、周晨砚 等 12 人",
    },
    {
      img: presetPhoto("zhou-fengyan"),
      ratio: "3/4",
      text: "下雨天，伞是同款这件事，应该没人发现吧。",
      time: "5 天前",
      likes: "哥哥、社团好友 等 9 人",
    },
  ],
};

function MomentsPreview({ charId, intro }: { charId: string; intro?: string }) {
  const posts = MOMENTS[charId];
  if (!posts) return null;
  return (
    <div className="mt-2 space-y-3">
      {intro && <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-foreground/80">{intro}</p>}
      {posts.map((p, i) => (
        <div key={i} className="rounded-xl bg-black/[0.03] p-3">
          <img
            src={p.img}
            alt="朋友圈配图"
            className="w-full max-w-[210px] rounded-lg object-cover shadow-sm"
            style={{ aspectRatio: p.ratio }}
          />
          <p className="mt-2 text-[12px] leading-relaxed text-[#576373]">{p.text}</p>
          <p className="mt-1 text-[10px] text-muted-foreground">{p.time}</p>
          <div className="mt-1.5 rounded-md bg-white/70 px-2 py-1 text-[10.5px] leading-relaxed text-[#576373]">
            ❤️ {p.likes}
          </div>
        </div>
      ))}
    </div>
  );
}

function SectionBlock({ sec, profile, onLoadIntro }: {
  sec: ProfileSection;
  profile: CharacterProfile;
  onLoadIntro?: () => void;
}) {
  // 卡面大标题分节（key=hero）由 HeroHeader 统一渲染，此处跳过避免重复
  if (sec.key === "hero") return null;

  if (sec.kind === "cover") {
    return (
      <div className="mb-6">
        {profile.coverUrl ? (
          <img src={profile.coverUrl} alt="立绘" className="w-full rounded-2xl object-cover" />
        ) : (
          <div className="flex h-40 w-full items-center justify-center rounded-2xl bg-black/[0.04] text-[11px] text-muted-foreground">
            未上传立绘 · 点击下方"上传图片"入口添加（1:1 或 3:4）
          </div>
        )}
        <p className="mt-2 text-[15px] font-bold text-foreground">{profile.name}</p>
        {sec.paras.map((p, i) => (
          <p key={i} className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{p}</p>
        ))}
      </div>
    );
  }

  if (sec.kind === "warning") {
    return (
      <div className="mb-6">
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
  const isPersonality = sec.key === "personality";
  // 社交账号分节：预置角色渲染朋友圈动态预览（图 + 文案 + 点赞）；
  // 旧版存储档案缺该分节时现场合并预置解析结果里的 social 分节，保证开场白卡也能看到
  if (sec.key === "social" && MOMENTS[profile.charId]) {
    return (
      <div className="mb-6">
        <p className="mb-2 text-[13px] font-bold text-foreground">{sec.title}</p>
        <MomentsPreview charId={profile.charId} intro={sec.paras.join("\n")} />
      </div>
    );
  }
  if (sec.key === "intro" && MOMENTS[profile.charId]) {
    const socialSec = presetProfileFor(profile.charId)?.sections.find((s) => s.key === "social");
    if (socialSec) {
      return (
        <div className="mb-6">
          <p className="mb-2 text-[13px] font-bold text-foreground">{socialSec.title}</p>
          <MomentsPreview charId={profile.charId} intro={socialSec.paras.join("\n")} />
        </div>
      );
    }
  }
  return (
    <div className="mb-6">
      <p className="mb-2 text-[13px] font-bold text-foreground">{sec.title}</p>
      {isPersonality ? <PersonalityBody paras={sec.paras} /> : <BasicBody paras={sec.paras} />}
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

/** 卡面头部：居中大标题（名字 × 你）+ 副句 —— 对齐截图第一屏；标签胶囊在 DuoCover 中渲染 */
function HeroHeader({ profile }: { profile: CharacterProfile }) {
  const hero = profile.sections.find((s) => s.key === "hero");
  // 旧版存储档案无 hero 分节时，用角色名兜底拼"× 你"大标题
  if (!hero) {
  return (
    <header className="pb-4 pt-1 text-center">
      <h2 className="text-[17px] font-bold leading-snug tracking-wide text-neutral-800">{profile.name} × 你</h2>
    </header>
  );
}
  // 兼容旧解析数据：titleLine 缺失且首段是短副句（不含键值冒号、≤30字）时提为副句
  const first = hero.paras[0] ?? "";
  const legacySub = !profile.titleLine && first.length <= 30 && !first.includes("：") ? first : undefined;
  const sub = profile.titleLine ?? legacySub;
  const paras = legacySub ? hero.paras.slice(1) : hero.paras;
  return (
    <header className="pb-4 pt-1 text-center">
      <h2 className="text-[17px] font-bold leading-snug tracking-wide text-neutral-800">{hero.title}</h2>
      {sub && <p className="mt-1.5 text-[11px] leading-relaxed text-neutral-500">{sub}</p>}
      {paras.map((p, i) => (
        <p key={i} className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-neutral-500">{p}</p>
      ))}
    </header>
  );
}

/** 基础信息 + 家人信息：立绘大图与文字左右并置（截图里"图片在左、身份/性格在右"版式） */
function DuoCover({ profile }: { profile: CharacterProfile }) {
  const basic = profile.sections.find((s) => s.key === "basic");
  const family = profile.sections.find((s) => s.key === "family");
  if (!basic && !family) return null;
  // 旧版存储档案无 hero 分节时，从"系列标签"行兜底取胶囊标签
  const legacyTags = !profile.tags ? basic?.paras.find((p) => p.startsWith("系列标签")) : undefined;
  const tags = profile.tags ?? legacyTags?.replace(/^系列标签[:：]\s*/, "").split(/[｜|]/).map((t) => t.trim()).filter(Boolean);
  const coverChar = profile.charId.includes("fengyan") ? "风" : "晨";
  // 立绘占位底色按角色区分：晨砚偏暖杏、风砚偏灰绿（对齐定妆照色调）
  const warm = !profile.charId.includes("fengyan");
  return (
    <div className="mb-6 rounded-2xl border border-primary/15 bg-white p-3 shadow-sm">
      {tags && tags.length > 0 && (
        <div className="mb-4 flex flex-wrap justify-center gap-1.5">
          {tags.map((t) => (
            <span key={t} className="rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 text-[10.5px] font-medium text-primary">
              {t}
            </span>
          ))}
        </div>
      )}
      <div className="flex items-start gap-3">
        <div className="w-[38%] shrink-0">
          {profile.coverUrl ? (
            <img src={profile.coverUrl} alt="立绘" className="aspect-[3/4] w-full rounded-2xl object-cover shadow-sm" />
          ) : presetCover(profile.charId) ? (
            <img src={presetCover(profile.charId)} alt="定妆照" className="aspect-[3/4] w-full rounded-2xl object-cover shadow-sm" />
          ) : (
            <div
              className="relative flex aspect-[3/4] w-full items-end justify-center overflow-hidden rounded-2xl shadow-sm"
              style={{
                background: warm
                  ? "linear-gradient(160deg, oklch(0.9 0.06 75), oklch(0.72 0.09 55))"
                  : "linear-gradient(160deg, oklch(0.89 0.04 130), oklch(0.7 0.06 145))",
              }}
            >
              <span className="pointer-events-none absolute -right-3 -top-6 select-none text-[110px] font-black leading-none text-white/55">{coverChar}</span>
              <span className="relative mb-3 rounded-full bg-white/75 px-3 py-1 text-[10px] tracking-widest text-neutral-600">立绘占位</span>
            </div>
          )}
          <p className="mt-1.5 text-center text-[13px] font-bold text-foreground">{profile.name}</p>
        </div>
        <div className="min-w-0 flex-1">
          {basic && (
            <>
              <SubTitle>基本资料</SubTitle>
              <BasicBody paras={basic.paras.filter((p) => !p.startsWith("系列标签"))} />
            </>
          )}
          {family && (
            <>
              <SubTitle>家人信息</SubTitle>
              <BasicBody paras={family.paras} />
            </>
          )}
        </div>
      </div>
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
  // 已并入头部/并置区的分节不再单独渲染；其余板块保持加粗标题+留白节奏
  const rest = profile.sections.filter(
    (s) => s.kind !== "cover" && s.key !== "basic" && s.key !== "family" && s.key !== "hero"
  );
  console.log(`[profile] render body char=${profile.charId} hero=${profile.sections.some((s) => s.key === "hero")} tags=${profile.tags?.length ?? 0} sections=${profile.sections.length}`);
  return (
    <div className="px-4 pb-4 pt-3">
      <HeroHeader profile={profile} />
      <DuoCover profile={profile} />
      {rest.map((sec) => (
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

export function ToolboxMenu({ hasProfile, onOpenProfile, onShowOpener, onImport, onSendPhoto, onTransfer, onLocation, onClose }: {
  hasProfile: boolean;
  onOpenProfile: () => void;
  onShowOpener: () => void;
  onImport: () => void;
  onSendPhoto: () => void;
  onTransfer: () => void;
  onLocation: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="absolute inset-0 z-30 bg-black/20" onClick={onClose} aria-hidden />
      <div className="glass-strong absolute bottom-16 left-3 z-40 w-56 fade-up overflow-hidden rounded-2xl p-2 shadow-xl">
        <p className="px-1.5 pb-1.5 pt-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground">工具箱</p>
        <div className="grid grid-cols-2 gap-1.5">
          <button type="button" onClick={onSendPhoto} className="jelly-btn flex flex-col items-center gap-1 rounded-xl bg-white/55 px-2 py-2.5 text-[11px] font-medium text-foreground">
            <ImagePlus className="size-4 text-primary" />
            发送图片
          </button>
          <button type="button" onClick={onTransfer} className="jelly-btn flex flex-col items-center gap-1 rounded-xl bg-white/55 px-2 py-2.5 text-[11px] font-medium text-foreground">
            <Banknote className="size-4 text-primary" />
            转账
          </button>
          <button type="button" onClick={onLocation} className="jelly-btn flex flex-col items-center gap-1 rounded-xl bg-white/55 px-2 py-2.5 text-[11px] font-medium text-foreground">
            <MapPin className="size-4 text-primary" />
            发送定位
          </button>
          <button type="button" onClick={onShowOpener} className="jelly-btn flex flex-col items-center gap-1 rounded-xl bg-white/55 px-2 py-2.5 text-[11px] font-medium text-foreground">
            <MessageSquareQuote className="size-4 text-primary" />
            角色开场白
          </button>
          <button
            type="button"
            onClick={onOpenProfile}
            disabled={!hasProfile}
            className="jelly-btn flex flex-col items-center gap-1 rounded-xl bg-white/55 px-2 py-2.5 text-[11px] font-medium text-foreground disabled:opacity-40"
          >
            <FileText className="size-4 text-primary" />
            人物档案
          </button>
          <button type="button" onClick={onImport} className="jelly-btn flex flex-col items-center gap-1 rounded-xl bg-white/55 px-2 py-2.5 text-[11px] font-medium text-foreground">
            <Upload className="size-4 text-primary" />
            导入档案
          </button>
        </div>
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

/* ---------- ④ 会话顶部开场白（进会话默认已展开，下滑可收起） ---------- */

export function OpenerCard({ profile, onCollapse }: {
  profile: CharacterProfile;
  onCollapse: () => void;
}) {
  return (
    <div className="mx-auto mb-2 w-full max-w-[96%] rounded-2xl bg-white shadow-sm">
      <div className="flex justify-center px-3 pb-1 pt-2">
        <button
          type="button"
          onClick={onCollapse}
          className="jelly-btn flex items-center gap-1.5 rounded-full glass px-4 py-1.5 text-[11px] font-semibold text-secondary-foreground"
        >
          <ChevronDown className="size-3 rotate-180" />
          收起开场白
        </button>
      </div>
      <ProfileBody profile={profile} />
    </div>
  );
}

/** 折叠后的开场白条：点击重新展开 */
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

/* ---------- ⑤ 聊天流内展开的完整档案（禁止局部折叠/分步加载，顶部一键收起） ---------- */

export function InlineProfileCard({ profile, onCollapse, onLoadIntro }: {
  profile: CharacterProfile;
  onCollapse: () => void;
  onLoadIntro?: () => void;
}) {
  return (
    <div className="mx-auto mb-2 w-full max-w-[96%] rounded-2xl bg-black/[0.05] backdrop-blur-sm">
      <div className="flex justify-center px-3 pb-1 pt-2">
        <button
          type="button"
          onClick={onCollapse}
          className="jelly-btn flex items-center gap-1.5 rounded-full glass px-4 py-1.5 text-[11px] font-semibold text-secondary-foreground"
        >
          <ChevronDown className="size-3 rotate-180" />
          一键收起
        </button>
      </div>
      <ProfileBody profile={profile} onLoadIntro={onLoadIntro} />
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
