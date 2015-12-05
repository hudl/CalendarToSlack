using Microsoft.Exchange.WebServices.Data;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Text;
using System.Threading.Tasks;

namespace CalendarToSlack
{
    class Program
    {
        static void Main(string[] args)
        {
            var calendar = new CalendarRetriever(args[0], args[1]);
            calendar.GetMyEvents();

            Console.ReadLine();
        }
    }

    class CalendarRetriever
    {
        private readonly ExchangeService _exchange;
        private readonly string _username;

        public CalendarRetriever(string username, string password)
        {
            if (string.IsNullOrWhiteSpace(username))
            {
                throw new ArgumentException("username");
            }

            _username = username;


            Console.WriteLine("Creating ExchangeSerivce");
            _exchange = new ExchangeService(TimeZoneInfo.Utc);
            _exchange.Credentials = new NetworkCredential(username, password);
            _exchange.AutodiscoverUrl(username, url => true);

            Console.WriteLine("ExchangeService created");
        }

        public void GetMyEvents()
        {
            Console.WriteLine("Getting availability for {0}", _username);
            var results = _exchange.GetUserAvailability(new List<AttendeeInfo>() { _username },
                                                    new TimeWindow(DateTime.Today, DateTime.Today.AddDays(1)),
                                                    AvailabilityData.FreeBusy);
            //var events = results.AttendeesAvailability.SelectMany(a => a.CalendarEvents).Select(e => new
            //{
            //    Subject = e.Details.Subject,
            //    StartTime = e.StartTime,
            //    EndTime = e.EndTime,
            //    Status = e.FreeBusyStatus.ToString()

            //}).OrderBy(e => e.StartTime).ToList();

            Console.WriteLine("Availability retrieved, parsing results");
            var events = results.AttendeesAvailability.SelectMany(a => a.CalendarEvents).OrderBy(e => e.StartTime);

            foreach (var e in events)
            {
                Console.WriteLine("event: {0} {1} {2} {3}", e.StartTime, e.EndTime, e.Details.Subject, e.FreeBusyStatus);
            }

            Console.WriteLine("Done.");
        }


    }

}
