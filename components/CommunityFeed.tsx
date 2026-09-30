"use client";

import { useState } from "react";
import { markHelpful } from "@/app/community/actions";
import type { CommunityPost } from "@/lib/types";

function timeAgo(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Baru saja";
  if (mins < 60) return `${mins} menit lalu`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} hari lalu`;
  return new Date(dateStr).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

const AVATAR_COLORS = ["#2F6FED", "#33B189", "#F5A623", "#8B6BF2", "#F2684B"];

export default function CommunityFeed({ posts, currentUserId }: { posts: CommunityPost[]; currentUserId: string }) {
  const [voted, setVoted] = useState<Set<string>>(new Set());
  const [localCounts, setLocalCounts] = useState<Record<string, number>>({});

  function handleHelpful(postId: string, currentCount: number) {
    if (voted.has(postId)) return;
    setVoted((prev) => new Set(prev).add(postId));
    setLocalCounts((prev) => ({ ...prev, [postId]: currentCount + 1 }));
    markHelpful(postId).catch(() => {
      setVoted((prev) => {
        const next = new Set(prev);
        next.delete(postId);
        return next;
      });
      setLocalCounts((prev) => ({ ...prev, [postId]: currentCount }));
    });
  }

  if (posts.length === 0) {
    return (
      <div className="card px-6 py-10 text-center text-sm text-soft">
        Belum ada cerita. Jadilah yang pertama berbagi.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3.5">
      {posts.map((post, i) => {
        const name = post.profiles?.display_name ?? "Caregiver";
        const verified = post.profiles?.is_verified ?? false;
        const isMine = post.author_id === currentUserId;
        const count = localCounts[post.id] ?? post.helpful_count;
        return (
          <div key={post.id} className="card px-5 py-4 sm:px-[22px] sm:py-5">
            <div className="flex items-center gap-3 mb-3">
              <div
                className="w-[38px] h-[38px] rounded-full text-white flex items-center justify-center font-extrabold text-sm flex-none"
                style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}
              >
                {name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-extrabold flex items-center gap-1.5 m-0">
                  {isMine ? "Kamu" : name}
                  {verified && (
                    <span className="inline-flex items-center gap-1 text-[9.5px] font-bold text-green-deep bg-green-tint px-1.5 py-0.5 rounded-full">
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.2}>
                        <path d="M4.5 12l5 5 10-10" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      Terverifikasi
                    </span>
                  )}
                </p>
                <span className="text-xs text-faint">
                  {post.profiles?.city ? `${post.profiles.city} · ` : ""}
                  {timeAgo(post.created_at)}
                </span>
              </div>
            </div>
            <p className="text-sm leading-relaxed mb-3">{post.body}</p>
            <button
              onClick={() => handleHelpful(post.id, post.helpful_count)}
              disabled={voted.has(post.id)}
              className={`text-xs font-bold px-3 py-1.5 rounded-full transition ${
                voted.has(post.id) ? "bg-primary-light text-primary" : "bg-bg text-soft hover:text-primary"
              }`}
            >
              {count} orang merasa terbantu{!voted.has(post.id) && " · Tandai membantu"}
            </button>
          </div>
        );
      })}
    </div>
  );
}
