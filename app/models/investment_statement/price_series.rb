# Daily closing prices per security over a period, as Series in the quote
# currency (a price chart should show the quote, not an FX-converted value).
class InvestmentStatement::PriceSeries
  MAX_POINTS = 400

  def initialize(securities, period:)
    @securities = securities.to_a.uniq
    @period = period
  end

  def by_security_id
    @by_security_id ||= prices_by_security.filter_map do |security_id, prices|
      next if prices.size < 2

      values = sample(prices).map do |price|
        { date: price.date, value: Money.new(price.price, price.currency) }
      end

      [ security_id, Series.from_raw_values(values) ]
    end.to_h
  end

  private
    attr_reader :securities, :period

    def prices_by_security
      Security::Price
        .where(security_id: securities.map(&:id), date: period.start_date..period.end_date)
        .order(:date)
        .select(:security_id, :date, :price, :currency)
        .group_by(&:security_id)
    end

    # Keeps first and last price so the period change stays exact.
    def sample(prices)
      return prices if prices.size <= MAX_POINTS

      step = (prices.size - 1).fdiv(MAX_POINTS - 1)
      (0...MAX_POINTS).map { |i| prices[(i * step).round] }.uniq
    end
end
