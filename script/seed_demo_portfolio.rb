# Dev only. Run after bin/rails demo_data:default:
#   bin/rails runner script/seed_demo_portfolio.rb
# Dev only: a demo portfolio shaped like a typical EU setup (two brokers,
# several ETFs, monthly savings plans) with synthetic prices. No real data.
srand(7)
family = Family.joins(:accounts).where(accounts: { accountable_type: "Investment" }).first
start = 3.years.ago.to_date.beginning_of_month

etfs = {
  "DEMO-WORLD" => [ "Demo MSCI World", 90, 0.0005, 0.010 ],
  "DEMO-EM"    => [ "Demo Emerging Markets", 50, 0.0002, 0.012 ],
  "DEMO-EU600" => [ "Demo STOXX Europe 600", 110, 0.0003, 0.009 ],
  "DEMO-GOLD"  => [ "Demo Physical Gold", 45, 0.0006, 0.009 ],
  "DEMO-IT"    => [ "Demo World IT", 60, 0.0009, 0.016 ]
}

securities = etfs.to_h do |ticker, (name, p0, drift, vol)|
  security = Security.find_or_create_by!(ticker: ticker, exchange_operating_mic: "XETR") do |s|
    s.name = name
    s.offline = true
    s.country_code = "DE"
  end
  price = p0.to_f
  rows = (start..Date.current).map do |date|
    price *= (1 + drift + (rand - 0.5) * 2 * vol) unless date.saturday? || date.sunday?
    { security_id: security.id, date: date, price: price.round(4), currency: "EUR", created_at: Time.current, updated_at: Time.current }
  end
  Security::Price.upsert_all(rows, unique_by: %i[security_id date currency])
  [ ticker, security ]
end

plans = {
  "Demo Scalable" => { "DEMO-WORLD" => 100, "DEMO-EM" => 50, "DEMO-EU600" => 30, "DEMO-GOLD" => 20 },
  "Demo Trade Republic" => { "DEMO-IT" => 50 }
}

plans.each do |name, plan|
  family.accounts.where(name: name).destroy_all
  account = family.accounts.create!(name: name, balance: 0, cash_balance: 0, currency: "EUR", accountable: Investment.new)

  month = start
  while month <= Date.current
    date = month + 3
    date += 1 while date.saturday? || date.sunday?
    break if date > Date.current

    total = plan.values.sum
    account.entries.create!(date: date, name: "Deposit", amount: -total, currency: "EUR", entryable: Transaction.new(kind: "funds_movement"))

    plan.each do |ticker, amount|
      security = securities[ticker]
      price = Security::Price.find_by(security: security, date: date).price
      qty = (amount / price).round(6)
      account.entries.create!(
        date: date, name: "Buy #{ticker}", amount: (qty * price).round(2), currency: "EUR",
        entryable: Trade.new(security: security, qty: qty, price: price, currency: "EUR")
      )
    end
    month = month.next_month
  end

  account.sync_later
  puts "#{name}: #{account.entries.count} entries"
end
