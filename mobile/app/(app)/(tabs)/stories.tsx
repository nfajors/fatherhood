import { useCallback, useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { api, ApiError } from "../../../src/api/client";
import type { Stories, StoryCard, StorySort } from "../../../src/api/types";
import { Body, Button, Loading, Notice, Pill, Screen, Title } from "../../../src/ui/components";
import { StoryRow } from "../../../src/ui/cards";
import { openTarget } from "../../../src/ui/navigate";
import { space } from "../../../src/ui/theme";

const SORTS: { id: StorySort; label: string }[] = [
  { id: "newest", label: "Newest" },
  { id: "trending", label: "Trending" },
  { id: "top_rated", label: "Top rated" },
];

/** Community Voices: fathers' own stories, free to everyone. */
export default function StoriesScreen() {
  const [sort, setSort] = useState<StorySort>("newest");
  const [theme, setTheme] = useState<string | null>(null);
  const [themes, setThemes] = useState<{ slug: string; name: string }[]>([]);
  const [videos, setVideos] = useState<StoryCard[] | null>(null);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (offset: number) => {
      setBusy(true);
      try {
        const q = new URLSearchParams({ sort, offset: String(offset), ...(theme ? { theme } : {}) });
        const page = await api<Stories>(`/api/mobile/v1/community?${q}`);
        setVideos((v) => (offset === 0 ? page.videos : [...(v ?? []), ...page.videos]));
        setNextOffset(page.nextOffset);
        if (page.themes) setThemes(page.themes);
        setError(null);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Something went wrong.");
      } finally {
        setBusy(false);
      }
    },
    [sort, theme],
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  return (
    <Screen refreshing={busy && videos !== null} onRefresh={() => load(0)}>
      <Title>Community Voices</Title>
      <Body muted style={{ marginTop: space(1) }}>Fathers telling their own stories.</Body>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: space(4) }}>
        {SORTS.map((s) => (
          <Pill key={s.id} label={s.label} selected={sort === s.id} onPress={() => setSort(s.id)} />
        ))}
      </ScrollView>
      {themes.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: space(2) }}>
          <Pill label="All themes" selected={!theme} onPress={() => setTheme(null)} />
          {themes.map((t) => (
            <Pill key={t.slug} label={t.name} selected={theme === t.slug} onPress={() => setTheme(t.slug)} />
          ))}
        </ScrollView>
      ) : null}
      {error && !videos ? <Notice message={error} action={{ title: "Try again", onPress: () => load(0) }} /> : null}
      {!videos && !error ? <Loading /> : null}
      {videos?.map((s) => <StoryRow key={s.id} story={s} onPress={() => openTarget({ kind: "community", videoId: s.id }, { title: s.title })} />)}
      {videos && videos.length === 0 ? <Notice message="No stories here yet." /> : null}
      {nextOffset !== null ? (
        <View style={{ marginTop: space(4) }}>
          <Button title="Show more" variant="secondary" busy={busy} onPress={() => load(nextOffset)} />
        </View>
      ) : null}
    </Screen>
  );
}
