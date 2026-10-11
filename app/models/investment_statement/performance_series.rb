# Builds daily performance series for investment accounts, one per account plus
# an "all accounts" aggregate, for the dashboard investment chart.
#
# Performance is a time-weighted return over the holdings (non-cash) part of
# each account, so contributions and withdrawals do not move the line. Cash is
# left out on purpose: provider-linked accounts (e.g. Trade Republic) book the
# cash leg of a buy against the portfolio account while the deposit lands on a
# separate cash account, which leaves the portfolio cash balance negative and
# would make any whole-account return meaningless.
#
# Each point carries three values the chart can switch between:
# - performance: chained daily return since period start (0.0 = 0 %)
# - gain:        cumulative market gain since period start, in family currency
# - value:       holdings value at end of day, in family currency
class InvestmentStatement::PerformanceSeries
  # Long periods are sampled down so the payload stays small; returns are
  # still chained over every day.
  MAX_POINTS = 400

  PALETTE = %w[#6366f1 #0ea5e9 #f59e0b #10b981 #ec4899 #8b5cf6 #14b8a6 #f97316].freeze

  Point = Data.define(:date, :performance, :gain, :value)
  Line = Data.define(:key, :name, :color, :points)

  def initialize(family, accounts:, period:)
    @family = family
    @accounts = accounts.to_a
    @period = period
  end

  # Aggregate first, then one line per account (ordered by current holdings value).
  def lines
    @lines ||= begin
      return [] if accounts.empty?

      rows_by_account = daily_rows.group_by(&:account_id)
      account_lines = accounts.each_with_index.filter_map do |account, idx|
        rows = rows_by_account[account.id]
        next if rows.blank?

        Line.new(
          key: account.id,
          name: account.name,
          color: PALETTE[idx % PALETTE.size],
          points: build_points(rows)
        )
      end

      aggregate_rows = daily_rows.group_by(&:date).sort.map do |date, rows|
        AggregateRow.new(
          date: date,
          start_value: rows.sum(&:start_value),
          end_value: rows.sum(&:end_value),
          inflow: rows.sum(&:inflow),
          market_flow: rows.sum(&:market_flow)
        )
      end

      next_lines = account_lines.sort_by { |line| -(line.points.last&.value || 0) }
      aggregate = Line.new(key: "all", name: nil, color: "var(--color-gray-500)", points: build_points(aggregate_rows))
      [ aggregate, *next_lines ]
    end
  end

  def as_json(*)
    {
      currency: family.currency,
      start_date: period.start_date,
      end_date: period.end_date,
      lines: lines.map do |line|
        {
          key: line.key,
          name: line.name,
          color: line.color,
          points: line.points.map do |p|
            { date: p.date, performance: p.performance.to_f.round(6), gain: p.gain.to_f.round(2), value: p.value.to_f.round(2) }
          end
        }
      end
    }
  end

  private
    attr_reader :family, :accounts, :period

    AggregateRow = Data.define(:date, :start_value, :end_value, :inflow, :market_flow)

    # Chains daily returns into a cumulative series. A day whose capital base is
    # not positive (account not funded yet) contributes no return.
    def build_points(rows)
      index = 1.to_d
      gain = 0.to_d

      points = rows.map do |row|
        base = row.start_value + [ row.inflow, 0 ].max
        index *= (1 + row.market_flow / base) if base.positive?
        gain += row.market_flow

        Point.new(date: row.date, performance: index - 1, gain: gain, value: row.end_value)
      end

      sample(points)
    end

    def sample(points)
      return points if points.size <= MAX_POINTS

      step = (points.size - 1).fdiv(MAX_POINTS - 1)
      (0...MAX_POINTS).map { |i| points[(i * step).round] }.uniq
    end

    # One row per account and day within the period, converted to family
    # currency. Rows before an account existed are simply absent.
    def daily_rows
      @daily_rows ||= Balance.find_by_sql([ <<~SQL, account_ids: accounts.map(&:id), currency: family.currency, start_date: period.start_date, end_date: period.end_date ])
        SELECT
          b.account_id,
          b.date,
          b.start_non_cash_balance * COALESCE(er.rate, 1) AS start_value,
          b.end_non_cash_balance * COALESCE(er.rate, 1) AS end_value,
          ((b.non_cash_inflows - b.non_cash_outflows) * b.flows_factor + b.non_cash_adjustments) * COALESCE(er.rate, 1) AS inflow,
          b.net_market_flows * COALESCE(er.rate, 1) AS market_flow
        FROM balances b
        LEFT JOIN exchange_rates er ON (
          er.date = b.date
          AND er.from_currency = b.currency
          AND er.to_currency = :currency
        )
        WHERE b.account_id IN (:account_ids)
          AND b.date BETWEEN :start_date AND :end_date
        ORDER BY b.date
      SQL
    end
end
