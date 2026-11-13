/**
 * PyqScreen.tsx — the previous-year-question archive as a document library, not
 * a card grid. A prominent search field plus course / exam-type / year chip
 * filters drive a paginated list of document-style paper cards (course, title,
 * exam type, year, slot, file type). Papers open in the system browser. All
 * queries go to the same public PostgREST archive; no student data leaves here.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../state/AppContext';
import {
  Caption,
  Chip,
  ChipRow,
  EmptyState,
  ErrorState,
  Row,
  ScreenHeader,
  Skeleton,
} from '../components/ui';
import { fetchPyqPage, fetchPyqCourses, ARCHIVE_PAGE_SIZE } from '../lib/publicApi';
import { PAGE, RADIUS, SP, TYPE, mono, FONT } from '../theme';
import type { ArchivePaper } from '../types';

export function PyqScreen() {
  const { theme } = useApp();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [courseCode, setCourseCode] = useState('');
  const [examType, setExamType] = useState('');
  const [year, setYear] = useState('');

  const [courses, setCourses] = useState<string[]>([]);
  const [papers, setPapers] = useState<ArchivePaper[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Exam-type and year facets accumulate from everything fetched so far, so we
  // never invent a value the archive does not actually contain.
  const examTypes = useRef<Set<string>>(new Set());
  const years = useRef<Set<string>>(new Set());
  const [, forceFacets] = useState(0);

  const listRef = useRef<FlatList<ArchivePaper>>(null);
  const loadingRef = useRef(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 350);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    fetchPyqCourses().then((c) => setCourses(c.slice(0, 60))).catch(() => undefined);
  }, []);

  const load = async (reset: boolean) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError('');
    try {
      const page = await fetchPyqPage({
        search: debounced,
        courseCode: courseCode || undefined,
        examType: examType || undefined,
        year: year || undefined,
        offset: reset ? 0 : papers.length,
        limit: ARCHIVE_PAGE_SIZE,
      });
      page.papers.forEach((p) => {
        if (p.exam_type) examTypes.current.add(p.exam_type);
        if (p.academic_year) years.current.add(p.academic_year);
      });
      setPapers((prev) => (reset ? page.papers : [...prev, ...page.papers]));
      setHasMore(page.hasMore);
      setLoaded(true);
      forceFacets((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load papers.');
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  };

  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    loadRef.current(true);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, courseCode, examType, year]);

  const examTypeList = useMemo(() => [...examTypes.current].sort(), [papers.length]);
  const yearList = useMemo(() => [...years.current].sort().reverse(), [papers.length]);
  const activeFilters = [courseCode, examType, year].filter(Boolean).length;

  const initialLoading = loading && !loaded;

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: theme.background }]} edges={['top']}>
      <View style={styles.head}>
        <ScreenHeader title="Question bank" subtitle="Previous-year papers from the archive" compact />
        <View style={[styles.searchBox, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Ionicons name="search" size={18} color={theme.textMuted} />
          <TextInput
            style={[styles.searchInput, { color: theme.text }]}
            placeholder="Search course code or title"
            placeholderTextColor={theme.textMuted}
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
            autoCapitalize="characters"
            autoCorrect={false}
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={theme.textMuted} />
            </Pressable>
          ) : null}
        </View>

        {courses.length ? (
          <ChipRow style={styles.chips}>
            {courses.map((c) => (
              <Chip key={c} label={c} selected={courseCode === c} onPress={() => setCourseCode(courseCode === c ? '' : c)} />
            ))}
          </ChipRow>
        ) : null}

        {examTypeList.length || yearList.length ? (
          <ChipRow style={styles.chips}>
            {examTypeList.map((t) => (
              <Chip key={t} label={t} selected={examType === t} onPress={() => setExamType(examType === t ? '' : t)} />
            ))}
            {yearList.map((y) => (
              <Chip key={y} label={y} selected={year === y} onPress={() => setYear(year === y ? '' : y)} />
            ))}
          </ChipRow>
        ) : null}

        {activeFilters > 0 ? (
          <Row style={styles.filterInfo}>
            <Caption>{papers.length} paper{papers.length === 1 ? '' : 's'}</Caption>
            <Pressable onPress={() => { setCourseCode(''); setExamType(''); setYear(''); }} hitSlop={6}>
              <Text style={[TYPE.caption, { color: theme.accent }]}>CLEAR FILTERS</Text>
            </Pressable>
          </Row>
        ) : null}
      </View>

      {error && !papers.length ? (
        <ErrorState message={error} onRetry={() => loadRef.current(true)} />
      ) : initialLoading ? (
        <View style={styles.skeletonList}>
          {Array.from({ length: 5 }).map((_, i) => (
            <View key={i} style={[styles.skelCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Skeleton width={44} height={56} radius={RADIUS.sm} />
              <View style={styles.flex}>
                <Skeleton width="70%" height={13} radius={6} />
                <Skeleton width="40%" height={11} radius={6} style={{ marginTop: 8 }} />
                <Skeleton width="55%" height={11} radius={6} style={{ marginTop: 8 }} />
              </View>
            </View>
          ))}
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={papers}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <EmptyState icon="documents-outline" title="No papers found" hint="Try a different course code, or clear the filters." />
          }
          onEndReached={() => hasMore && loadRef.current(false)}
          onEndReachedThreshold={0.4}
          ListFooterComponent={loading && papers.length ? <Skeleton width="100%" height={72} radius={RADIUS.lg} style={{ marginTop: SP.sm }} /> : null}
          renderItem={({ item }) => <PaperCard paper={item} onOpen={() => Linking.openURL(item.paper_url).catch(() => undefined)} />}
        />
      )}
    </SafeAreaView>
  );
}

function PaperCard({ paper, onOpen }: { paper: ArchivePaper; onOpen: () => void }) {
  const { theme } = useApp();
  const isPdf = (paper.file_type || '').toLowerCase().includes('pdf') || paper.paper_url.toLowerCase().includes('.pdf');
  return (
    <Pressable onPress={onOpen} android_ripple={{ color: theme.surfaceMuted }} style={[styles.paper, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={[styles.docTile, { backgroundColor: theme.surfaceMuted }]}>
        <Ionicons name={isPdf ? 'document-text' : 'document'} size={22} color={theme.accent} />
        <Text style={[styles.docType, { color: theme.textMuted }]}>{(paper.file_type || (isPdf ? 'PDF' : 'DOC')).toUpperCase().slice(0, 4)}</Text>
      </View>
      <View style={styles.paperBody}>
        <Text style={[TYPE.caption, { color: theme.accent, letterSpacing: 0.6 }]}>{paper.course_code || 'PAPER'}</Text>
        <Text style={[styles.paperTitle, { color: theme.text }]} numberOfLines={2}>
          {paper.title || paper.course_title || paper.course_code || 'Question paper'}
        </Text>
        <Row style={styles.paperChips}>
          {paper.exam_type ? <TagPill label={paper.exam_type} /> : null}
          {paper.academic_year ? <TagPill label={paper.academic_year} /> : null}
          {paper.slot ? <TagPill label={paper.slot} /> : null}
          {paper.answer_key_included ? <TagPill label="Key" tone="success" /> : null}
        </Row>
      </View>
      <View style={styles.openCol}>
        <Ionicons name="open-outline" size={18} color={theme.accent} />
      </View>
    </Pressable>
  );
}

function TagPill({ label, tone }: { label: string; tone?: 'success' }) {
  const { theme } = useApp();
  return (
    <View style={[styles.tagPill, { backgroundColor: tone === 'success' ? theme.successSoft : theme.surfaceMuted }]}>
      <Text style={[TYPE.caption, { color: tone === 'success' ? theme.success : theme.textMuted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  head: { padding: PAGE, paddingBottom: SP.sm },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, borderWidth: 1, borderRadius: RADIUS.md, paddingHorizontal: SP.md + 2, height: 50, marginTop: SP.sm },
  searchInput: { flex: 1, fontFamily: FONT.medium, fontSize: 15 },
  chips: { marginTop: SP.md },
  filterInfo: { justifyContent: 'space-between', alignItems: 'center', marginTop: SP.md, paddingHorizontal: 2 },

  skeletonList: { padding: PAGE, gap: SP.sm },
  skelCard: { flexDirection: 'row', gap: SP.md, borderRadius: RADIUS.lg, borderWidth: 1, padding: SP.md, alignItems: 'center' },

  list: { paddingHorizontal: PAGE, paddingBottom: SP.xxl + 16, flexGrow: 1, paddingTop: SP.sm },
  paper: { flexDirection: 'row', gap: SP.md, borderRadius: RADIUS.lg, borderWidth: 1, padding: SP.md, marginBottom: SP.sm, alignItems: 'center' },
  docTile: { width: 50, height: 62, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center', gap: 4 },
  docType: { ...mono('bold'), fontSize: 9, letterSpacing: 0.3 },
  paperBody: { flex: 1 },
  paperTitle: { fontFamily: FONT.bold, fontSize: 14, lineHeight: 19, marginTop: 3, letterSpacing: -0.2 },
  paperChips: { gap: 6, marginTop: SP.sm, flexWrap: 'wrap' },
  tagPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.pill },
  openCol: { paddingLeft: 2 },
});
