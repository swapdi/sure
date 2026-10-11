# Net worth over time plus one line per balance sheet account group
# (Cash, Investments, Property, Loans, ...) for the dashboard net worth chart.
# Liability groups are shown as positive amounts owed, like on the balance sheet.
class BalanceSheet::NetWorthGroupSeries
  # section: classification name ("Assets" / "Liabilities"), nil for the total
  Line = Data.define(:key, :name, :color, :section, :series)

  def initialize(balance_sheet, period:)
    @balance_sheet = balance_sheet
    @period = period
  end

  def lines
    @lines ||= begin
      total = Line.new(key: "all", name: nil, color: nil, section: nil, series: balance_sheet.net_worth_series(period: period))
      sections = balance_sheet.classification_groups.to_h { |group| [ group.classification, group.name ] }

      groups = balance_sheet.account_groups.filter_map do |group|
        account_ids = group.accounts.map(&:id)
        next if account_ids.empty?

        series = Balance::ChartSeriesBuilder.new(
          account_ids: account_ids,
          currency: balance_sheet.currency,
          period: period,
          favorable_direction: group.classification == "liability" ? "down" : "up"
        ).balance_series
        next if series.values.size < 2

        Line.new(key: group.key, name: group.name, color: group.color, section: sections[group.classification], series: series)
      end

      [ total, *groups ]
    end
  end

  def as_json(*)
    {
      currency: balance_sheet.currency,
      lines: lines.map do |line|
        {
          key: line.key,
          name: line.name,
          color: line.color,
          points: line.series.values.map { |v| { date: v.date, value: amount(v.value) } }
        }
      end
    }
  end

  private
    attr_reader :balance_sheet, :period

    def amount(value)
      (value.respond_to?(:amount) ? value.amount : value).to_f.round(2)
    end
end
