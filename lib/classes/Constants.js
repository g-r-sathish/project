/**
 * Constants that have no logical class to reside on, or that would result in circular dependencies if they did reside
 * on their logical owner class.
 */
const _ = require('underscore');
class Constants {
  static Projects = {
    Status: {
      ACTIVE: 'ACTIVE',
      IGNORED: 'IGNORED',
      PENDING: 'PENDING',
      RETIRED: 'RETIRED'
    },
    GitTarget: {
      COMMIT_PREFIX: '\\',
      MAINLINE: ':',
      NO_OP: '~',
      TAG_PREFIX: '^'
    }
  }

  static Trunks = {
    MASTER: 'master'
  }

  static UpdateTypes = {
    PULL_REQUEST: 'PULL_REQUEST',
    X_RAY_RESULT: 'X_RAY_RESULT'
  }

  static UIProjects = {
    "rgui": 'stay-rgui',
    "contentpackage": 'stay-content-package',
    "stay-befe": 'stay-befe'
  }

  static NaagProjects = {
    "nodeapiaggregator": 'stay-nodeapiaggregator',
  }

  static SVCProjects = {
    "victorsrootpom": 'stay-victors-root-pom',
    "stayrootpom": 'stay-root-pom',
    "postgresops": 'stay-postgresops',
    "pmscommon": 'stay-pms-common',
    "waper": 'stay-waper',
    "mongoops": 'stay-mongoops',
    "rguestpayshim": 'stay-rguestpayshim',
    "commentinterface": 'stay-comment-interface',
    "rateinterface": 'stay-rate-interface',
    "reportinterface": 'stay-report-interface',
    "servicerequestinterface": 'stay-servicerequest-interface',
    "propertyinterface": 'stay-property-interface',
    "paymentinterface": 'stay-payment-interface',
    "relayinterface": 'stay-relay-interface',
    "payeventinterface": 'stay-pay-event-interface',
    "integrationinterface": 'stay-integration-interface',
    "accountinterface": 'stay-account-interface',
    "profileinterface": 'stay-profile-interface',
    "reservationinterface": 'stay-reservation-interface',
    "integrationcore": 'stay-integration-core',
    "integrationappliance": 'stay-integration-appliance',
    "integrationproxyservice": 'stay-integration-proxy-service',
    "aggregator": 'stay-aggregator',
    "integrationmodulesa": 'stay-integration-modulesa',
    "integrationmodulesb": 'stay-integration-modulesb',
    "commentservice": 'stay-comment-service',
    "rateservice": 'stay-rate-service',
    "paymentservice": 'stay-payment-service',
    "profileservice": 'stay-profile-service',
    "payeventservice": 'stay-pay-event-service',
    "accountservice": 'stay-account-service',
    "propertyservice": 'stay-property-service',
    "reportsaggregator": 'stay-reports-aggregator',
    "watchdogservice": 'stay-watchdog-service',
    "reservationservice": 'stay-reservation-service',
    "igconnectorservice": 'stay-igconnector-service',
    "integrationservice": 'stay-integration-service',
    "relayservice": 'stay-relay-service',
    "servicerequestservice": 'stay-servicerequest-service',
    "reportservice": 'stay-report-service',
    "staysvcbom": 'stay-svc-bom',
    "pms-qa-common": 'stay-qa-pms-qa-common',
    "insertanator": 'stay-qa-insertanator',
    "karat-meter": 'stay-qa-karat-meter'
  }

  static SupportProjects = {
    "deployment": 'devops-deployment',
    "inventory": 'devops-inventory',
    "databasescripts": 'stay-databasescripts',
    "staycustomcontent": 'stay-custom-content',
  }

}

module.exports = {
  Projects: Constants.Projects,
  Trunks: Constants.Trunks,
  UpdateTypes: Constants.UpdateTypes,
  GithubMapping: _.chain({}).extend(Constants.UIProjects).extend(Constants.SVCProjects).extend(Constants.NaagProjects).extend(Constants.SupportProjects).value()
}