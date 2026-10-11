require "test_helper"

class InvestmentStatement::PerformanceSeriesTest < ActiveSupport::TestCase
  setup do
    @family = families(:empty)
    @period = Period.custom(start_date: Date.new(2026, 1, 1), end_date: Date.new(2026, 1, 3))
  end

  test "chains daily returns and ignores contributions" do
    account = create_investment_account
    # Day 1: 1000 -> 1100 (+10 %)
    balance(account, Date.new(2026, 1, 1), start: 1000, inflow: 0, market: 100)
    # Day 2: 1000 contributed, then +5 % on 2100
    balance(account, Date.new(2026, 1, 2), start: 1100, inflow: 1000, market: 105)
    # Day 3: -10 % on 2205
    balance(account, Date.new(2026, 1, 3), start: 2205, inflow: 0, market: -220.5)

    all = series(account).lines.first
    assert_equal "all", all.key

    performance = all.points.map { |p| p.performance.to_f.round(6) }
    assert_equal [ 0.1, 0.155, 0.0395 ], performance
    assert_equal [ 100, 205, -15.5 ], all.points.map { |p| p.gain.to_f }
    assert_equal [ 1100, 2205, 1984.5 ], all.points.map { |p| p.value.to_f }
  end

  test "aggregates accounts by summing capital and market flows" do
    a = create_investment_account
    b = create_investment_account
    balance(a, Date.new(2026, 1, 1), start: 1000, inflow: 0, market: 100)
    balance(b, Date.new(2026, 1, 1), start: 3000, inflow: 0, market: -100)

    lines = series(a, b).lines
    assert_equal 3, lines.size
    assert_in_delta 0.0, lines.first.points.last.performance.to_f, 1e-9
    assert_equal [ 0.1, -0.033333 ], lines.drop(1).map { |l| l.points.last.performance.to_f.round(6) }.sort.reverse
  end

  test "an unfunded day contributes no return" do
    account = create_investment_account
    balance(account, Date.new(2026, 1, 1), start: 0, inflow: 0, market: 0)
    balance(account, Date.new(2026, 1, 2), start: 0, inflow: 500, market: 50)

    points = series(account).lines.first.points
    assert_equal [ 0.0, 0.1 ], points.map { |p| p.performance.to_f.round(6) }
  end

  test "no accounts yields no lines" do
    assert_equal [], InvestmentStatement::PerformanceSeries.new(@family, accounts: [], period: @period).lines
  end

  private
    def series(*accounts)
      InvestmentStatement::PerformanceSeries.new(@family, accounts: accounts, period: @period)
    end

    def create_investment_account
      @family.accounts.create!(
        name: "Broker #{SecureRandom.hex(3)}",
        balance: 0,
        cash_balance: 0,
        currency: @family.currency,
        accountable: Investment.new
      )
    end

    def balance(account, date, start:, inflow:, market:)
      Balance.create!(
        account: account,
        date: date,
        balance: start + inflow + market,
        currency: @family.currency,
        start_non_cash_balance: start,
        non_cash_inflows: inflow,
        net_market_flows: market
      )
    end
end
