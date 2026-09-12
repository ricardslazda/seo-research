import {
    index,
    integer,
    real,
    sqliteTable,
    text,
    uniqueIndex,
    type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

export const runs = sqliteTable('runs', {
    id: integer().primaryKey({ autoIncrement: true }),
    phase: text().notNull(),
    startedAt: text('started_at').notNull(),
    finishedAt: text('finished_at'),
    argsJson: text('args_json').notNull(),
    notes: text(),
});

export const rawResponses = sqliteTable(
    'raw_responses',
    {
        id: integer().primaryKey({ autoIncrement: true }),
        runId: integer('run_id').references(() => runs.id),
        endpoint: text().notNull(),
        requestHash: text('request_hash').notNull(),
        requestJson: text('request_json').notNull(),
        responseJson: text('response_json').notNull(),
        httpStatus: integer('http_status').notNull(),
        taskStatusCode: integer('task_status_code').notNull(),
        cost: real().notNull(),
        fetchedAt: text('fetched_at').notNull(),
    },
    (table) => [
        index('raw_responses_lookup').on(table.endpoint, table.requestHash, table.fetchedAt),
    ],
);

export const decisions = sqliteTable(
    'decisions',
    {
        id: integer().primaryKey({ autoIncrement: true }),
        runId: integer('run_id').references(() => runs.id),
        subjectType: text('subject_type').notNull(),
        subjectId: text('subject_id').notNull(),
        kind: text().notNull(),
        value: text().notNull(),
        reason: text().notNull(),
        madeBy: text('made_by').notNull(),
        evidenceRawId: integer('evidence_raw_id').references(() => rawResponses.id),
        madeAt: text('made_at').notNull(),
    },
    (table) => [index('decisions_subject').on(table.subjectType, table.subjectId, table.kind)],
);

export const services = sqliteTable('services', {
    key: text().primaryKey(),
    headJson: text('head_json').notNull(),
});

export const places = sqliteTable('places', {
    slug: text().primaryKey(),
    locationCode: integer('location_code').notNull(),
    kind: text().notNull(),
    parentSlug: text('parent_slug'),
    nameJson: text('name_json').notNull(),
});

export const candidates = sqliteTable(
    'candidates',
    {
        id: integer().primaryKey({ autoIncrement: true }),
        serviceKey: text('service_key')
            .notNull()
            .references(() => services.key),
        placeSlug: text('place_slug')
            .notNull()
            .references(() => places.slug),
    },
    (table) => [uniqueIndex('candidates_pair').on(table.serviceKey, table.placeSlug)],
);

export const keywords = sqliteTable(
    'keywords',
    {
        id: integer().primaryKey({ autoIncrement: true }),
        text: text().notNull(),
        language: text().notNull(),
        locationCode: integer('location_code').notNull(),
        candidateId: integer('candidate_id').references(() => candidates.id),
        role: text().notNull(),
        variantOf: integer('variant_of').references((): AnySQLiteColumn => keywords.id),
        variantKind: text('variant_kind'),
        firstRawId: integer('first_raw_id').references(() => rawResponses.id),
    },
    (table) => [
        uniqueIndex('keywords_identity').on(table.text, table.language, table.locationCode),
    ],
);

export const keywordMetrics = sqliteTable(
    'keyword_metrics',
    {
        id: integer().primaryKey({ autoIncrement: true }),
        keywordId: integer('keyword_id')
            .notNull()
            .references(() => keywords.id),
        source: text().notNull(),
        volume: integer(),
        volumeStatus: text('volume_status').notNull(),
        cpc: real(),
        competitionIndex: integer('competition_index'),
        bidLow: real('bid_low'),
        bidHigh: real('bid_high'),
        monthlyJson: text('monthly_json'),
        seriesHash: text('series_hash'),
        difficulty: integer(),
        intentEndpoint: text('intent_endpoint'),
        intentProbability: real('intent_probability'),
        fetchedAt: text('fetched_at').notNull(),
        rawId: integer('raw_id').references(() => rawResponses.id),
    },
    (table) => [index('keyword_metrics_keyword').on(table.keywordId, table.source)],
);

export const keywordOrigins = sqliteTable(
    'keyword_origins',
    {
        id: integer().primaryKey({ autoIncrement: true }),
        keywordId: integer('keyword_id')
            .notNull()
            .references(() => keywords.id),
        source: text().notNull(),
        seed: text().notNull(),
        rawId: integer('raw_id').references(() => rawResponses.id),
    },
    (table) => [
        uniqueIndex('keyword_origins_identity').on(table.keywordId, table.source, table.seed),
    ],
);

export const serps = sqliteTable(
    'serps',
    {
        id: integer().primaryKey({ autoIncrement: true }),
        keywordId: integer('keyword_id')
            .notNull()
            .references(() => keywords.id),
        locationCode: integer('location_code').notNull(),
        language: text().notNull(),
        device: text().notNull(),
        depth: integer().notNull(),
        firstOrganicRank: integer('first_organic_rank'),
        itemTypesJson: text('item_types_json').notNull(),
        fetchedAt: text('fetched_at').notNull(),
        rawId: integer('raw_id').references(() => rawResponses.id),
    },
    (table) => [index('serps_keyword').on(table.keywordId)],
);

export const serpItems = sqliteTable(
    'serp_items',
    {
        id: integer().primaryKey({ autoIncrement: true }),
        serpId: integer('serp_id')
            .notNull()
            .references(() => serps.id),
        rankAbsolute: integer('rank_absolute').notNull(),
        rankGroup: integer('rank_group').notNull(),
        type: text().notNull(),
        domain: text(),
        url: text(),
        title: text(),
        payloadJson: text('payload_json'),
    },
    (table) => [index('serp_items_serp').on(table.serpId, table.rankAbsolute)],
);

export const domains = sqliteTable('domains', {
    domain: text().primaryKey(),
    referringDomains: integer('referring_domains'),
    backlinks: integer(),
    referringMainDomains: integer('referring_main_domains'),
    fetchedAt: text('fetched_at').notNull(),
    rawId: integer('raw_id').references(() => rawResponses.id),
    labsKeywords: integer('labs_keywords'),
    labsEtv: real('labs_etv'),
    labsFetchedAt: text('labs_fetched_at'),
    labsRawId: integer('labs_raw_id').references(() => rawResponses.id),
});

export const domainPages = sqliteTable(
    'domain_pages',
    {
        id: integer().primaryKey({ autoIncrement: true }),
        domain: text()
            .notNull()
            .references(() => domains.domain),
        url: text().notNull(),
        keywordsCount: integer('keywords_count'),
        etv: real(),
        pos1: integer('pos_1'),
        pos2to3: integer('pos_2_3'),
        pos4to10: integer('pos_4_10'),
        fetchedAt: text('fetched_at').notNull(),
        rawId: integer('raw_id').references(() => rawResponses.id),
    },
    (table) => [uniqueIndex('domain_pages_url').on(table.domain, table.url)],
);

export const domainKeywords = sqliteTable(
    'domain_keywords',
    {
        id: integer().primaryKey({ autoIncrement: true }),
        domain: text()
            .notNull()
            .references(() => domains.domain),
        keywordId: integer('keyword_id')
            .notNull()
            .references(() => keywords.id),
        position: integer(),
        url: text(),
        etv: real(),
        rawId: integer('raw_id').references(() => rawResponses.id),
    },
    (table) => [uniqueIndex('domain_keywords_pair').on(table.domain, table.keywordId)],
);

export const pageAnatomy = sqliteTable(
    'page_anatomy',
    {
        id: integer().primaryKey({ autoIncrement: true }),
        domain: text()
            .notNull()
            .references(() => domains.domain),
        url: text().notNull(),
        httpStatus: integer('http_status'),
        title: text(),
        wordCount: integer('word_count'),
        headingsCount: integer('headings_count'),
        questionsCount: integer('questions_count'),
        phoneCount: integer('phone_count'),
        hasPrices: integer('has_prices', { mode: 'boolean' }),
        ratingValue: real('rating_value'),
        ratingCount: integer('rating_count'),
        navLinksJson: text('nav_links_json'),
        bodyLinksJson: text('body_links_json'),
        headingsJson: text('headings_json'),
        fetchedAt: text('fetched_at').notNull(),
        rawId: integer('raw_id').references(() => rawResponses.id),
    },
    (table) => [uniqueIndex('page_anatomy_url').on(table.url)],
);

export const referringDomains = sqliteTable(
    'referring_domains',
    {
        id: integer().primaryKey({ autoIncrement: true }),
        target: text().notNull(),
        domain: text().notNull(),
        rank: integer(),
        backlinks: integer(),
        spamScore: integer('spam_score'),
        firstSeen: text('first_seen'),
        nofollow: integer({ mode: 'boolean' }),
        countriesJson: text('countries_json'),
        platformsJson: text('platforms_json'),
        fetchedAt: text('fetched_at').notNull(),
        rawId: integer('raw_id').references(() => rawResponses.id),
    },
    (table) => [uniqueIndex('referring_domains_pair').on(table.target, table.domain)],
);

export const listings = sqliteTable(
    'listings',
    {
        id: integer().primaryKey({ autoIncrement: true }),
        placeSlug: text('place_slug')
            .notNull()
            .references(() => places.slug),
        cid: text().notNull(),
        title: text(),
        category: text(),
        rating: real(),
        votes: integer(),
        claimed: integer({ mode: 'boolean' }),
        domain: text(),
        address: text(),
        lat: real(),
        lng: real(),
        fetchedAt: text('fetched_at').notNull(),
        rawId: integer('raw_id').references(() => rawResponses.id),
    },
    (table) => [uniqueIndex('listings_place_cid').on(table.placeSlug, table.cid)],
);

export const rankReadings = sqliteTable(
    'rank_readings',
    {
        id: integer().primaryKey({ autoIncrement: true }),
        keywordId: integer('keyword_id')
            .notNull()
            .references(() => keywords.id),
        domain: text().notNull(),
        position: integer(),
        url: text(),
        pageKey: text('page_key'),
        pathMatches: integer('path_matches', { mode: 'boolean' }),
        ownPagesJson: text('own_pages_json'),
        packPresent: integer('pack_present', { mode: 'boolean' }),
        packHasBusiness: integer('pack_has_business', { mode: 'boolean' }),
        serpId: integer('serp_id').references(() => serps.id),
        readAt: text('read_at').notNull(),
    },
    (table) => [index('rank_readings_keyword').on(table.keywordId, table.domain)],
);
