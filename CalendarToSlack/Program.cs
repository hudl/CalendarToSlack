using System.Collections.Generic;
using System.IO;
using System.Linq;
using CalendarToSlack.Http;
using System;
using log4net;
using log4net.Appender;
using log4net.Config;
using log4net.Core;
using log4net.Layout;

namespace CalendarToSlack
{
    // TODO error handling, move beyond a prototype
    // TODO convert to a service?

    class Program
    {
        private static readonly ILog Log = LogManager.GetLogger(typeof (Program).Name);

        static void Main(string[] args)
        {
            var datadir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "CalendarToSlack");
            Directory.CreateDirectory(datadir);

            SetupLogging(Path.Combine(datadir, "log.txt"));

            Log.DebugFormat("Starting up with data directory {0}", datadir);

            var configPath = Path.Combine(datadir, "config.txt");
            if (args.Length > 0)
            {
                configPath = args[0];
            }
            
            var config = LoadConfig(configPath);

            var slack = new Slack();

            var userdbfile = Path.Combine(datadir, "db-users.txt");
            var markdbfile = Path.Combine(datadir, "db-marks.txt");

            var userdb = new UserDatabase(userdbfile, slack);
            var markdb = new MarkedEventDatabase(markdbfile);

            var calendar = new Calendar(config[Config.ExchangeUsername], config[Config.ExchangePassword]);

            var updater = new Updater(userdb, markdb, calendar, slack);
            updater.Start();

            var consumer = new SlackCommandConsumer(
                config[Config.SlackCommandVerificationToken],
                config[Config.AwsAccessKey],
                config[Config.AwsSecretKey],
                config[Config.AwsSqsQueueUrl],
                updater);
            consumer.Start();

            var server = new HttpServer(config[Config.SlackApplicationClientId], config[Config.SlackApplicationClientSecret], slack, userdb);
            server.Start();
            
            Console.ReadLine();
        }

        private static Dictionary<Config, string> LoadConfig(string path)
        {
            var lines = File.ReadAllLines(path);
            return lines.Where(line => !line.StartsWith("#")).ToDictionary(line => (Config) Enum.Parse(typeof(Config), line.Split('=')[0]), line => line.Split('=')[1]);
        }

        private enum Config
        {
            ExchangeUsername,
            ExchangePassword,
            SlackApplicationClientId,
            SlackApplicationClientSecret,
            SlackCommandVerificationToken,
            AwsAccessKey,
            AwsSecretKey,
            AwsSqsQueueUrl,
        }

        private static void SetupLogging(string file)
        {
            var layout = new PatternLayout("%utcdate [%-5level] [%20.30logger] %message%newline");

            var appender = new RollingFileAppender
            {
                Threshold = Level.Debug,
                AppendToFile = true,
                File = file,
                MaximumFileSize = "10MB",
                RollingStyle = RollingFileAppender.RollingMode.Size,
                MaxSizeRollBackups = 5,
                StaticLogFileName = true,
                Layout = layout,
            };

            var console = new ColoredConsoleAppender
            {
                Threshold = Level.Debug,
                Layout = layout,
            };
            
            console.AddMapping(new ColoredConsoleAppender.LevelColors
            {
                ForeColor = ColoredConsoleAppender.Colors.Green,
                Level = Level.Info,
            });

            console.AddMapping(new ColoredConsoleAppender.LevelColors
            {
                ForeColor = ColoredConsoleAppender.Colors.Yellow,
                Level = Level.Warn,
            });

            console.AddMapping(new ColoredConsoleAppender.LevelColors
            {
                ForeColor = ColoredConsoleAppender.Colors.Red,
                Level = Level.Error,
            });

            console.AddMapping(new ColoredConsoleAppender.LevelColors
            {
                ForeColor = ColoredConsoleAppender.Colors.Red,
                Level = Level.Fatal,
            });
            appender.ActivateOptions();
            console.ActivateOptions();

            BasicConfigurator.Configure(appender, console);
        }
    }
}
