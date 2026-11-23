// 面具（世界线关系包）管理页：列表展示 / 新增 / 编辑 / 删除（默认面具不可删）/ 应用切换。
// 只影响【玩家与角色的关系、过往、感情基调】；基础人设与世界书规则全局固定不受影响（注入侧已约束）。
import { useEffect, useState } from "react";
import { Check, ChevronLeft, Pencil, Plus, ShieldQuestion, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Character } from "@/lib/chat-types";
import {
  loadMasks,
  saveMasks,
  getActiveMaskId,
  setActiveMaskId,
  maskPreview,
  MASK_MAX,
  type Mask,
} from "@/lib/mask-store";

const newId = () => `mk${Date.now()}${Math.floor(Math.random() * 900 + 100)}`;

export function MaskPanel({
  character,
  onBack,
  onApplied,
}: {
  character: Character;
  onBack: () => void;
  /** 应用面具后回调：父级把切换标记写入会话记录并回到聊天页 */
  onApplied: (mask: Mask) => void;
}) {
  const [masks, setMasks] = useState<Mask[]>(() => loadMasks(character.id, character));
  const [activeId, setActiveId] = useState<string>(() => getActiveMaskId(character.id));
  // editing === null 未在编辑；"new" 正在新增；其余为被编辑面具的 id
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [background, setBackground] = useState("");
  const [tone, setTone] = useState("");
  const [askDelete, setAskDelete] = useState<string | null>(null);

  // 切角色时重读（本组件按 charId 条件渲染，正常会重挂载；此 effect 为 key 复用兜底）
  useEffect(() => {
    setMasks(loadMasks(character.id, character));
    setActiveId(getActiveMaskId(character.id));
    setEditing(null);
  }, [character.id, character]);

  const commit = (next: Mask[]) => {
    setMasks(next);
    saveMasks(character.id, next);
  };

  const startEdit = (m: Mask) => {
    setEditing(m.id);
    setName(m.name);
    setBackground(m.background);
    setTone(m.tone);
  };
  const startNew = () => {
    if (masks.length >= MASK_MAX) return;
    setEditing("new");
    setName("");
    setBackground("");
    setTone("");
  };
  const cancelEdit = () => setEditing(null);

  const saveEdit = () => {
    const n = name.trim();
    if (!n) return;
    if (editing === "new") {
      const m: Mask = { id: newId(), name: n, background: background.trim(), tone: tone.trim() };
      commit([...masks, m]);
      console.log(`[mask] created char=${character.id} id=${m.id} name=${n}`);
    } else if (editing) {
      // 修改后立即生效：注入侧每次现算读存储，应用的正是修改后的当前版本
      commit(masks.map((x) => (x.id === editing ? { ...x, name: n, background: background.trim(), tone: tone.trim() } : x)));
      console.log(`[mask] edited char=${character.id} id=${editing}（应用中的面具改完即读新版本）`);
    }
    setEditing(null);
  };

  const apply = (m: Mask) => {
    if (m.id === activeId) return;
    setActiveMaskId(character.id, m.id);
    setActiveId(m.id);
    console.log(`[mask] applied char=${character.id} →「${m.name}」`);
    onApplied(m);
  };

  const doDelete = (id: string) => {
    const m = masks.find((x) => x.id === id);
    if (!m || m.isDefault) return;
    commit(masks.filter((x) => x.id !== id));
    if (activeId === id) {
      setActiveMaskId(character.id, "mask-default");
      setActiveId("mask-default");
    }
    setAskDelete(null);
    console.log(`[mask] deleted char=${character.id} id=${id} name=${m.name}`);
  };

  const editingMask = editing && editing !== "new" ? masks.find((x) => x.id === editing) : null;

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="glass-nav flex items-center justify-between px-2 py-2">
        <Button variant="ghost" size="icon" className="jelly-icon size-8" onClick={onBack} aria-label="返回">
          <ChevronLeft className="size-5" />
        </Button>
        <span className="text-sm font-semibold">TA 们的面具 · {character.alias?.trim() || character.name}</span>
        <span className="size-8" />
      </div>

      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 pb-6 pt-3">
        <p className="rounded-xl bg-muted/40 px-3 py-2 text-[10.5px] leading-relaxed text-muted-foreground">
          面具 = 独立世界线关系包：只定义你和她之间的背景、过往、关系与感情基调。
          她的性格和世界底层规则不随面具改变；同一时间只有一个面具生效，其余互不干扰。
        </p>

        {masks.map((m) => {
          const isActive = m.id === activeId;
          return (
            <div
              key={m.id}
              className={`glass rounded-2xl p-3 transition-colors ${isActive ? "border-primary/50 bg-primary/5" : ""}`}
            >
              <div className="flex items-center gap-2">
                <span className="truncate text-[13.5px] font-semibold">{m.name}</span>
                {m.isDefault && (
                  <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">默认</span>
                )}
                {isActive && (
                  <span className="jelly-btn ml-auto inline-flex shrink-0 items-center gap-0.5 rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground">
                    <Check className="size-3" /> 使用中
                  </span>
                )}
              </div>
              <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">{maskPreview(m)}</p>
              <div className="mt-2 flex items-center gap-1.5">
                {!isActive && (
                  <button
                    type="button"
                    onClick={() => apply(m)}
                    className="jelly-btn rounded-full bg-primary/10 px-3 py-1 text-[11px] font-medium text-primary"
                  >
                    应用
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => startEdit(m)}
                  aria-label="编辑面具"
                  className="jelly-icon inline-flex size-7 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                >
                  <Pencil className="size-3.5" />
                </button>
                {!m.isDefault && (
                  <button
                    type="button"
                    onClick={() => setAskDelete(m.id)}
                    aria-label="删除面具"
                    className="jelly-icon inline-flex size-7 items-center justify-center rounded-full text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
                {isActive && <span className="ml-auto text-[10px] text-muted-foreground">对话将遵循这条世界线</span>}
              </div>
            </div>
          );
        })}

        {editing && (
          <div className="drawer-panel glass-strong space-y-2 rounded-2xl p-3">
            <p className="text-[12px] font-semibold">{editing === "new" ? "新增面具" : `编辑「${editingMask?.name ?? ""}」`}</p>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="面具名称（如：久别重逢的老同学）"
              maxLength={20}
              className="h-9 rounded-lg glass-input text-[12.5px]"
            />
            <Textarea
              value={background}
              onChange={(e) => setBackground(e.target.value)}
              placeholder="关系背景：你们怎么认识、发生过什么、现在的处境……（自由填写）"
              maxLength={800}
              rows={4}
              className="rounded-lg glass-input resize-none text-[12.5px]"
            />
            <Textarea
              value={tone}
              onChange={(e) => setTone(e.target.value)}
              placeholder="感情基调：这段关系的情绪底色与走向（如：酸涩的单向暗恋 / 她主动追求我）"
              maxLength={400}
              rows={2}
              className="rounded-lg glass-input resize-none text-[12.5px]"
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" className="jelly-btn h-8 rounded-xl text-xs" onClick={cancelEdit}>
                取消
              </Button>
              <Button size="sm" className="jelly-btn h-8 rounded-xl text-xs" disabled={!name.trim()} onClick={saveEdit}>
                保存
              </Button>
            </div>
          </div>
        )}

        {!editing && (
          <button
            type="button"
            onClick={startNew}
            disabled={masks.length >= MASK_MAX}
            className="jelly-btn glass flex w-full items-center justify-center gap-1.5 rounded-2xl py-3 text-[12.5px] font-medium text-muted-foreground disabled:opacity-50"
          >
            {masks.length >= MASK_MAX ? <ShieldQuestion className="size-4" /> : <Plus className="size-4" />}
            {masks.length >= MASK_MAX ? `最多 ${MASK_MAX} 个面具` : "新增面具"}
          </button>
        )}
      </div>

      {askDelete && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/40 p-8">
          <div className="drawer-panel w-full max-w-[280px] rounded-2xl bg-white p-5 text-center shadow-2xl">
            <p className="text-[14px] font-semibold text-neutral-800">撕掉这张面具？</p>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-neutral-500">
              「{masks.find((x) => x.id === askDelete)?.name}」将被永久删除，该世界线的设定不再存在。
            </p>
            <div className="mt-4 flex gap-2">
              <Button variant="outline" size="sm" className="jelly-btn h-9 flex-1 rounded-xl text-xs" onClick={() => setAskDelete(null)}>
                再想想
              </Button>
              <Button size="sm" className="jelly-btn h-9 flex-1 rounded-xl bg-destructive text-xs text-white hover:bg-destructive/90" onClick={() => doDelete(askDelete)}>
                撕掉
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
