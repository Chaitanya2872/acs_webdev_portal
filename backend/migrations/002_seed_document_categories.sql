-- Website document pages, mirroring acs-web src/data/investorDocuments.js and src/data/navigation.js.
-- slug = the website route (/investors/<slug>, /newsletters); legacy_folder = the folder under /assets/docs on the current site.
-- s3_prefix is relative to S3_DOCUMENTS_PREFIX.

INSERT INTO document_categories (slug, name, s3_prefix, website_path, legacy_folder, legacy_page, sort_order) VALUES
  ('annual-reports', 'Annual Reports', 'annual-reports', '/investors/annual-reports', 'Annual Reports', 'annual_reports.html', 10),
  ('annual-return', 'Annual Return', 'annual-returns', '/investors/annual-return', 'Annual Return', 'annual_return.html', 20),
  ('financial-results', 'Financial Results', 'financial-results', NULL, NULL, NULL, 30),
  ('investor-presentations', 'Investor Presentations', 'investor-presentations', '/investors/investor-presentations', 'presentations', 'investor_presentations.html', 40),
  ('stock-exchange-filings', 'Stock Exchange Filings', 'stock-exchange-filings', '/investors/stock-exchange-filings', NULL, NULL, 50),
  ('code-of-conduct', 'Code of Conduct', 'code-of-conduct', '/investors/code-of-conduct', 'Code of Conduct', 'code_of_conduct.html', 60),
  ('subsidiary-financials', 'Subsidiary Financials', 'subsidiary-financials', NULL, NULL, NULL, 70),
  ('moa-and-aoa', 'MOA & AOA', 'moa-aoa', '/investors/moa-and-aoa', 'MOA_AOA', 'moa_&_aoa.html', 80),
  ('newsletters', 'Newsletters', 'newsletters', '/newsletters', 'Newsletters', 'newsletters.html', 90);

INSERT INTO document_categories (parent_id, slug, name, s3_prefix, website_path, legacy_folder, legacy_page, sort_order)
SELECT parent.id, child.slug, child.name, child.s3_prefix, child.website_path, child.legacy_folder, child.legacy_page, child.sort_order
FROM (VALUES
  ('financial-results', 'audited-financial-results', 'Audited Financial Results', 'financial-results/audited', '/investors/audited-financial-results', 'Financial Results', 'audited_financial_results.html', 10),
  ('financial-results', 'unaudited-financial-results', 'Unaudited Financial Results', 'financial-results/unaudited', '/investors/unaudited-financial-results', 'Financial Results', 'unaudited_financial_results.html', 20),

  ('stock-exchange-filings', 'share-holding-patterns', 'Share Holding Patterns', 'stock-exchange-filings/shareholding-patterns', '/investors/share-holding-patterns', 'shareholdingpattern', 'share_holding_patterns.html', 10),
  ('stock-exchange-filings', 'corporate-governance', 'Corporate Governance', 'stock-exchange-filings/corporate-governance', '/investors/corporate-governance', 'Corporate governence', 'corporate_governance.html', 20),
  ('stock-exchange-filings', 'integrated-corporate-governance', 'Integrated Corporate Governance', 'stock-exchange-filings/integrated-governance', '/investors/integrated-corporate-governance', 'Integrated corporate governance', 'integrated_corporate_governance.html', 30),
  ('stock-exchange-filings', 'related-party-transaction', 'Related Party Transactions', 'stock-exchange-filings/related-party-transactions', '/investors/related-party-transaction', 'Related Party Transaction', 'related_party_transaction.html', 40),
  ('stock-exchange-filings', 'annual-secretarial-compliance', 'Annual Secretarial Compliance', 'stock-exchange-filings/secretarial-compliance', '/investors/annual-secretarial-compliance', 'Annual Secreterial Compliance', 'annual_secreterial_compliance.html', 50),
  ('stock-exchange-filings', 'integrated-filing', 'Integrated Filing', 'stock-exchange-filings/integrated-filings', '/investors/integrated-filing', 'Integrated Filling', 'integrated_filling.html', 60),
  ('stock-exchange-filings', 'intimation-of-board-meetings', 'Intimation of Board Meetings', 'stock-exchange-filings/board-meetings/intimations', '/investors/intimation-of-board-meetings', 'Intimation of Board Meetings', 'intimation_of_board_meetings.html', 70),
  ('stock-exchange-filings', 'outcome-of-board-meetings', 'Outcome of Board Meetings', 'stock-exchange-filings/board-meetings/outcomes', '/investors/outcome-of-board-meetings', 'Outcome of board meetings', 'outcome_of_board_meetings.html', 80),
  ('stock-exchange-filings', 'intimation-of-general-meeting', 'Intimation of General Meetings', 'stock-exchange-filings/general-meetings/intimations', '/investors/intimation-of-general-meeting', 'Intimation of General Meeting', 'intimation_of_general_meeting.html', 90),
  ('stock-exchange-filings', 'outcome-of-general-meetings', 'Outcome of General Meetings', 'stock-exchange-filings/general-meetings/outcomes', '/investors/outcome-of-general-meetings', 'Outcome of General Meeting', 'outcome_of_general_meetings.html', 100),
  ('stock-exchange-filings', 'regulation-30-disclosures', 'Disclosures Under Regulation 30 of LODR', 'stock-exchange-filings/regulation-30', '/investors/regulation-30-disclosures', 'Announcement under Regulation 30 LODR', 'disclosures_under-regulation_30_of_lodr.html', 110),
  ('stock-exchange-filings', 'postal-ballot', 'Postal Ballot', 'stock-exchange-filings/postal-ballots', '/investors/postal-ballot', 'Postal Ballot', 'postal_ballot.html', 120),
  ('stock-exchange-filings', 'closure-of-trading-window', 'Closure of Trading Window', 'stock-exchange-filings/trading-window-closures', '/investors/closure-of-trading-window', 'closure of trading window', 'closure_of_trading_window.html', 130),
  ('stock-exchange-filings', 'other-filings', 'Other Filings', 'stock-exchange-filings/other-filings', '/investors/other-filings', 'others', 'sef_others.html', 140),
  ('stock-exchange-filings', 'newspaper-publications', 'Newspaper Publications', 'stock-exchange-filings/newspaper-publications', '/investors/newspaper-publications', 'News paper publication', 'newspaper_publications.html', 150),
  ('stock-exchange-filings', 'notices', 'Notices', 'stock-exchange-filings/notices', '/investors/notices', 'Notices', 'notices.html', 160),
  ('stock-exchange-filings', 'press-and-media-releases', 'Press and Media Releases', 'stock-exchange-filings/press-releases', '/investors/press-and-media-releases', 'Press and Media Releases', 'press_and_media_releases.html', 170),
  ('stock-exchange-filings', 'receipt-of-orders', 'Intimation of Receipt of Orders', 'stock-exchange-filings/receipt-of-orders', '/investors/receipt-of-orders', 'Receipt Of Orders', 'receipt_of_orders.html', 180),

  ('subsidiary-financials', 'iotiq-financials', 'IOTIQ Innovations Pvt Ltd - Subsidiary Financials', 'subsidiary-financials/iotiq-innovations', '/investors/iotiq-financials', 'Subsdiary Financials', 'subsdiary_financials.html', 10),
  ('subsidiary-financials', 'innovistas-financials', 'Innovistas Innovations Pvt Ltd - Subsidiary Financials', 'subsidiary-financials/innovistas-innovations', '/investors/innovistas-financials', 'Subsdiary Financials', 'innovista_financials.html', 20)
) AS child (parent_slug, slug, name, s3_prefix, website_path, legacy_folder, legacy_page, sort_order)
JOIN document_categories parent ON parent.slug = child.parent_slug;
