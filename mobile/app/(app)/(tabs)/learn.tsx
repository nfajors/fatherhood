import type { CourseCard } from "../../../src/api/types";
import { useApi } from "../../../src/api/useApi";
import { CourseRow } from "../../../src/ui/cards";
import { Body, Loading, Notice, Screen, Title } from "../../../src/ui/components";
import { openTarget } from "../../../src/ui/navigate";
import { space } from "../../../src/ui/theme";

/** The Professional Academy. */
export default function LearnScreen() {
  const { data, error, refreshing, refresh } = useApi<{ courses: CourseCard[] }>("/api/mobile/v1/courses");
  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Title>The Academy</Title>
      <Body muted style={{ marginTop: space(1) }}>Courses from experts and experienced fathers, built around the book.</Body>
      {error && !data ? <Notice message={error.message} action={{ title: "Try again", onPress: refresh }} /> : null}
      {!data && !error ? <Loading /> : null}
      {data?.courses.map((c) => <CourseRow key={c.slug} course={c} onPress={() => openTarget({ kind: "course", courseSlug: c.slug })} />)}
      {data && data.courses.length === 0 ? <Notice message="Courses are on their way." /> : null}
    </Screen>
  );
}
