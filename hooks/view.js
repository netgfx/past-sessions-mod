// past-sessions: draws the pane from a plain model; every press goes back
// through `act`, so this file never touches $

import { archivedSessions, COLLAPSED_COUNT, fit, formatSize, lastActive, longDate, queryTerms, shortAge, visibleSessions } from './lib.js'

const AGE_COLUMNS = 6
// Session titles use Claude's own orange, so they stand out from the labels
const TITLE_COLOR = 'claude'
// The selected session's card: a border and one column of padding each side
const CARD_INSET = 4

export function renderPane(E, m, act) {
  const { Box, Text, Button, Input } = E
  const width = Math.max(20, m.width)
  const children = []
  const isSearch = queryTerms(m.query).length > 0

  const list = visibleSessions(m.sessions, {
    pins: m.pins,
    archived: m.archived,
    expanded: m.expanded,
    count: COLLAPSED_COUNT,
    query: m.query,
  })
  const archivedList = archivedSessions(m.sessions, m.archived, m.query)
  // A search shows its archived matches without being asked
  const showArchived = isSearch || m.showArchived
  // Collapsed, the hidden rows are never read, so only those on screen count;
  // a search reads every transcript
  const onScreen = isSearch ? m.sessions : [...list.pinned, ...list.others, ...(showArchived ? archivedList : [])]
  const pending = onScreen.filter((s) => !s.summary).length
  const found = list.total + archivedList.length

  children.push(
    Box({
      key: 'head',
      flexDirection: 'row',
      justifyContent: 'space-between',
      width,
      children: [
        Text({
          bold: true,
          children: ['Past sessions' + (isSearch ? ' · ' + found + (found === 1 ? ' match' : ' matches') : list.total ? ' · ' + list.total : '')],
        }),
        Box({
          flexDirection: 'row',
          columnGap: 2,
          children: [
            Button({ key: 'search-open', label: 'Search', hotkey: 's', plain: true, dimColor: true, onPress: act.openSearch }),
            Button({ key: 'refresh', label: m.scanning || pending ? 'loading…' : 'refresh', plain: true, dimColor: true, onPress: act.refresh }),
          ],
        }),
      ],
    }),
  )

  if (m.problem) {
    children.push(Text({ color: 'warning', wrap: 'wrap', children: [m.problem] }))
    return Box({ flexDirection: 'column', children })
  }

  if (m.searching || m.query) {
    children.push(
      Box({
        key: 'search-row',
        flexDirection: 'row',
        columnGap: 2,
        width,
        children: [
          Box({
            flexGrow: 1,
            children: [
              Input({
                key: 'search',
                placeholder: 'title, prompt, branch…',
                value: m.query,
                submitLabel: 'open top match',
                onInput: (value) => act.search(value),
                onSubmit: (value) => act.submitSearch(value),
              }),
            ],
          }),
          Button({ key: 'search-clear', label: 'Clear', hotkey: 'x', plain: true, dimColor: true, onPress: act.clearSearch }),
        ],
      }),
    )
  }

  if (m.status) {
    children.push(Text({ ...(m.statusIsError ? { color: 'warning' } : { dimColor: true }), wrap: 'wrap', children: [m.status] }))
  }

  if (isSearch) {
    if (pending) children.push(Text({ dimColor: true, wrap: 'wrap', children: ['Searching… ' + pending + ' more to read'] }))
    else if (!found) children.push(Text({ dimColor: true, wrap: 'wrap', children: ['No sessions match "' + m.query.trim() + '".'] }))
  } else if (list.total === 0 && !pending) {
    children.push(Text({ dimColor: true, wrap: 'wrap', children: ['No other sessions in this project yet.'] }))
  }

  let sections = 0
  const section = (label, rows) => {
    if (!rows.length) return
    children.push(sectionLabel(E, label, sections++ > 0))
    for (const s of rows) children.push(row(E, m, act, s, width))
  }
  section('Pinned', list.pinned)
  // A lone group needs no heading
  if (list.pinned.length) section('Recent', list.others)
  else for (const s of list.others) children.push(row(E, m, act, s, width))

  // A search shows every match, so it needs neither More nor Archived
  const footer = []
  if (!isSearch && list.hidden > 0) {
    footer.push(Button({ key: 'more', label: 'More… (' + list.hidden + ')', hotkey: 'm', plain: true, onPress: act.toggleMore }))
  } else if (!isSearch && m.expanded && list.others.length > COLLAPSED_COUNT) {
    footer.push(Button({ key: 'less', label: 'Less…', hotkey: 'm', plain: true, onPress: act.toggleMore }))
  }
  if (!isSearch && archivedList.length) {
    footer.push(
      Button({
        key: 'archived',
        label: (m.showArchived ? 'Hide archived' : 'Archived') + ' (' + archivedList.length + ')',
        hotkey: 'h',
        plain: true,
        dimColor: true,
        onPress: act.toggleArchived,
      }),
    )
  }
  if (footer.length) children.push(Box({ key: 'footer', flexDirection: 'row', columnGap: 3, marginTop: 1, children: footer }))

  if (showArchived && archivedList.length) section('Archived', archivedList)

  // With the keyboard here and nothing open yet, say how to get around
  if (m.isFocused && !m.selected && found) {
    const hint = isSearch ? 'Enter in the search opens the top match · x clears it' : 'Up/Down move · Enter open · s search · Esc back to prompt'
    children.push(Box({ key: 'hint', marginTop: 1, children: [Text({ dimColor: true, wrap: 'wrap', children: [hint] })] }))
  }

  return Box({ flexDirection: 'column', children })
}

function sectionLabel(E, label, spaced) {
  const { Box, Text } = E
  return Box({
    key: 'section-' + label,
    ...(spaced ? { marginTop: 1 } : {}),
    children: [Text({ dimColor: true, bold: true, children: [label] })],
  })
}

// One session's line; the selected one opens into a card holding its details
function row(E, m, act, s, width) {
  const { Box } = E
  const isSelected = m.selected === s.id
  if (!isSelected) return line(E, m, act, s, width, false)
  return Box({
    key: 'card-' + s.id,
    flexDirection: 'column',
    borderStyle: 'round',
    borderColor: TITLE_COLOR,
    paddingX: 1,
    width,
    children: [line(E, m, act, s, width - CARD_INSET, true), details(E, m, act, s, width - CARD_INSET)],
  })
}

function line(E, m, act, s, width, isSelected) {
  const { Box, Text, Button } = E
  const isArchived = m.archived.has(s.id)
  const title = s.summary ? s.summary.title || '(untitled)' : 'loading…'
  // Inside the card the border marks the selection; outside, two columns line
  // the titles up with the card's
  const label = (isSelected ? '' : '  ') + fit(title, width - AGE_COLUMNS - 3)
  const isMuted = isArchived || !s.summary
  return Box({
    key: 'line-' + s.id,
    flexDirection: 'row',
    justifyContent: 'space-between',
    width,
    children: [
      Button({
        key: 'row-' + s.id,
        label,
        plain: true,
        onPress: () => act.select(s.id),
        children: [Text({ ...(isMuted ? { dimColor: true } : { color: TITLE_COLOR }), ...(isSelected ? { bold: true } : {}), children: [label] })],
      }),
      Text({ dimColor: true, children: [shortAge(s.mtimeMs, m.now).padStart(AGE_COLUMNS)] }),
    ],
  })
}

function details(E, m, act, s, width) {
  const { Box, Text, Button } = E
  const sum = s.summary
  const lines = []
  if (!sum) {
    lines.push(Text({ dimColor: true, children: ['Reading the transcript…'] }))
  } else {
    // The whole title, when the line above had to cut it
    if (sum.title && sum.title.length > width - AGE_COLUMNS - 3) {
      lines.push(Text({ color: TITLE_COLOR, bold: true, wrap: 'wrap', children: [sum.title] }))
    }
    lines.push(Text({ dimColor: true, children: ['Task'] }))
    lines.push(Text({ wrap: 'wrap', children: [sum.firstPrompt || '(no prompt)'] }))
    if (sum.lastPrompt && sum.lastPrompt !== sum.firstPrompt) {
      lines.push(Text({ dimColor: true, children: ['Last request'] }))
      lines.push(Text({ wrap: 'wrap', children: [sum.lastPrompt] }))
    }
    const facts = [
      ['Started ' + longDate(sum.startedAt, m.now), lastActive(s.mtimeMs, m.now)].filter(Boolean).join(' · '),
      [plural(sum.prompts, 'prompt') + (sum.isPartial ? '+' : ''), sum.branch ? 'branch ' + sum.branch : '', formatSize(s.size)]
        .filter(Boolean)
        .join(' · '),
    ]
    lines.push(Box({ key: 'facts-' + s.id, flexDirection: 'column', marginTop: 1, children: facts.map((f) => Text({ dimColor: true, wrap: 'wrap', children: [f] })) }))
  }
  lines.push(Text({ dimColor: true, children: [fit(s.id, width)] }))

  const isPinned = m.pins.has(s.id)
  const isArchived = m.archived.has(s.id)
  // Resume stands out; the rest are plain so the row fits one line
  const buttons = [
    Button({ key: 'resume', label: 'r: Resume', hotkey: 'r', variant: 'primary', autoFocus: true, onPress: () => act.resume(s.id) }),
  ]
  if (!isArchived) {
    buttons.push(Button({ key: 'pin', label: isPinned ? 'Unpin' : 'Pin', hotkey: 'p', plain: true, onPress: () => act.pin(s.id) }))
  }
  buttons.push(Button({ key: 'archive', label: isArchived ? 'Unarchive' : 'Archive', hotkey: 'a', plain: true, onPress: () => act.archive(s.id) }))
  buttons.push(Button({ key: 'copy', label: 'Copy', hotkey: 'c', plain: true, dimColor: true, onPress: (e) => act.copy(s.id, e) }))

  return Box({
    key: 'details-' + s.id,
    flexDirection: 'column',
    children: [
      ...lines,
      Box({ key: 'actions-' + s.id, flexDirection: 'row', columnGap: 2, rowGap: 0, flexWrap: 'wrap', marginTop: 1, children: buttons }),
    ],
  })
}

function plural(n, word) {
  return n + ' ' + word + (n === 1 ? '' : 's')
}
